import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { buildWebhookUrl } from "../../lib/webhook-signing";

const FAL_BASE_URL = "https://queue.fal.run";
const FAL_TEXT_TO_VIDEO_ENDPOINT =
  "fal-ai/bytedance/seedance/v1.5/pro/text-to-video";
const FAL_IMAGE_TO_VIDEO_ENDPOINT =
  "fal-ai/bytedance/seedance/v1.5/pro/image-to-video";
const FAL_REQUEST_TIMEOUT_MS = 15_000;
const WAITPOINT_TIMEOUT = "15m";

const taskInputSchema = z.object({
  mode: z.enum(["text-to-video", "image-to-video"]).default("text-to-video"),
  prompt: z.string().min(1, "Prompt is required"),
  image_url: z.string().url().optional(),
  end_image_url: z.string().url().optional(),
  aspect_ratio: z
    .enum(["16:9", "21:9", "4:3", "1:1", "3:4", "9:16", "auto"])
    .optional()
    .default("16:9"),
  resolution: z.enum(["480p", "720p", "1080p"]).optional().default("720p"),
  duration: z
    .enum(["4", "5", "6", "7", "8", "9", "10", "11", "12"])
    .optional()
    .default("5"),
  camera_fixed: z.boolean().optional().default(false),
  generate_audio: z.boolean().optional().default(true),
  enable_safety_checker: z.boolean().optional().default(true),
  seed: z.string().optional(),
});

const falQueueResponseSchema = z.object({
  request_id: z.string(),
  status: z.string().optional(),
  queue_position: z.number().optional(),
});

const falWebhookSuccessSchema = z.object({
  request_id: z.string(),
  status: z.literal("OK"),
  payload: z.object({
    video: z.object({
      url: z.string().url(),
    }),
    seed: z.number().optional(),
  }),
});

const falWebhookErrorSchema = z.object({
  request_id: z.string(),
  status: z.literal("ERROR"),
  error: z.string(),
});

export const seedanceTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "seedance-generate",
  retry: { maxAttempts: 1 },

  run: async (payload: {
    mode?: string;
    prompt: string;
    image_url?: string;
    end_image_url?: string;
    aspect_ratio?: string;
    resolution?: string;
    duration?: string;
    camera_fixed?: boolean;
    generate_audio?: boolean;
    enable_safety_checker?: boolean;
    seed?: string;
  }) => {
    logger.info("Starting Seedance 1.5 Pro video generation", {
      mode: payload.mode,
      promptLength: payload.prompt?.length,
      hasImageUrl: !!payload.image_url,
    });

    // ── 1. Validate input ───────────────────────────────────────────────
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Input validation failed", { issues });
      throw new Error(`Seedance input validation failed: ${issues}`);
    }
    const input = inputResult.data;

    // ── 2. Mode-specific guard ──────────────────────────────────────────
    if (input.mode === "image-to-video" && !input.image_url) {
      throw new Error(
        "image-to-video mode requires image_url. " +
          "Connect an Image node or provide a valid image URL."
      );
    }

    // ── 3. Select fal.ai endpoint ───────────────────────────────────────
    const falEndpoint =
      input.mode === "image-to-video"
        ? FAL_IMAGE_TO_VIDEO_ENDPOINT
        : FAL_TEXT_TO_VIDEO_ENDPOINT;

    logger.info("Endpoint selected", { mode: input.mode, endpoint: falEndpoint });

    // ── 4. Create waitpoint token ───────────────────────────────────────
    const token = await wait.createToken({
      timeout: WAITPOINT_TIMEOUT,
      tags: ["seedance-1.5", input.mode],
    });

    logger.info("Waitpoint token created", {
      tokenId: token.id,
      isCached: token.isCached,
    });

    // ── 5. Build HMAC-signed webhook URL ────────────────────────────────
    const webhookUrl = buildWebhookUrl(token.id);

    // ── 6. Build fal.ai request body ────────────────────────────────────
    const falBody: Record<string, unknown> = {
      prompt: input.prompt,
    };

    if (input.mode === "image-to-video") {
      falBody.image_url = input.image_url;
      if (input.end_image_url) falBody.end_image_url = input.end_image_url;
    }

    if (input.aspect_ratio) falBody.aspect_ratio = input.aspect_ratio;
    if (input.resolution) falBody.resolution = input.resolution;

    // duration stays as a string per the official fal.ai OpenAPI schema
    if (input.duration) falBody.duration = input.duration;

    if (input.camera_fixed !== undefined) falBody.camera_fixed = input.camera_fixed;
    if (input.generate_audio !== undefined) falBody.generate_audio = input.generate_audio;
    if (input.enable_safety_checker !== undefined)
      falBody.enable_safety_checker = input.enable_safety_checker;

    if (input.seed) {
      const parsed = parseInt(input.seed, 10);
      if (!isNaN(parsed)) falBody.seed = parsed;
    }

    // ── 7. POST to fal.ai queue endpoint ────────────────────────────────
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      throw new Error(
        "FAL_KEY environment variable is not set. " +
          "Add your fal.ai API key to your Trigger.dev environment variables."
      );
    }

    const falUrl = `${FAL_BASE_URL}/${falEndpoint}?fal_webhook=${encodeURIComponent(webhookUrl)}`;
    logger.info("Sending request to fal.ai", { url: `${FAL_BASE_URL}/${falEndpoint}` });

    let queueResponse: Response;
    try {
      queueResponse = await fetch(falUrl, {
        method: "POST",
        headers: {
          Authorization: `Key ${falApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(falBody),
        signal: AbortSignal.timeout(FAL_REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(
          `fal.ai connection timeout: Initial request to ${falEndpoint} ` +
            `did not respond within ${FAL_REQUEST_TIMEOUT_MS / 1000}s`
        );
      }
      throw new Error(
        `fal.ai network error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // ── 8. Handle non-200 ───────────────────────────────────────────────
    if (!queueResponse.ok) {
      let errorBody = "";
      try {
        errorBody = await queueResponse.text();
      } catch {
        errorBody = "(could not read response body)";
      }
      logger.error("fal.ai returned non-200", {
        status: queueResponse.status,
        body: errorBody.slice(0, 500),
      });
      throw new Error(
        `fal.ai returned ${queueResponse.status}: ${errorBody.slice(0, 200)}`
      );
    }

    // ── 9. Validate queue response ──────────────────────────────────────
    let queueData: unknown;
    try {
      queueData = await queueResponse.json();
    } catch {
      throw new Error("fal.ai returned 200 but response is not valid JSON");
    }

    const queueResult = falQueueResponseSchema.safeParse(queueData);
    if (queueResult.success) {
      logger.info("Job queued successfully", {
        requestId: queueResult.data.request_id,
        queuePosition: queueResult.data.queue_position,
      });
    } else {
      logger.warn("fal.ai queue response has unexpected shape", {
        raw: JSON.stringify(queueData).slice(0, 500),
      });
    }

    // ── 10. Wait for webhook callback (15min timeout) ───────────────────
    logger.info("Waiting for fal.ai callback...", { timeout: WAITPOINT_TIMEOUT });

    const waitResult = await wait.forToken<unknown>(token);

    if (!waitResult.ok) {
      throw new Error(
        "Provider timeout: fal.ai did not respond within 15 minutes. " +
          "Video generation may still be processing on fal.ai's side. " +
          "Try again or check fal.ai's status page."
      );
    }

    const webhookPayload = waitResult.output;

    logger.info("Webhook payload received", {
      status: (webhookPayload as Record<string, unknown>)?.status,
    });

    // ── 11. Check for fal.ai error response ─────────────────────────────
    const errorResult = falWebhookErrorSchema.safeParse(webhookPayload);
    if (errorResult.success) {
      throw new Error(
        `fal.ai generation failed: ${errorResult.data.error}`
      );
    }

    // ── 12. Validate successful response ────────────────────────────────
    const successResult = falWebhookSuccessSchema.safeParse(webhookPayload);
    if (!successResult.success) {
      const issues = successResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Invalid provider response shape", {
        issues,
        rawKeys: Object.keys(
          (webhookPayload as Record<string, unknown>) || {}
        ),
        raw: JSON.stringify(webhookPayload).slice(0, 1000),
      });
      throw new Error(
        `Invalid provider response: ${issues}. ` +
          "fal.ai returned a 200 but the response did not match the expected schema."
      );
    }

    const videoUrl = successResult.data.payload.video.url;
    const seed = successResult.data.payload.seed;

    logger.info("Seedance 1.5 Pro generation complete", {
      videoUrl: videoUrl.slice(0, 80) + "...",
      seed,
    });

    // ── 13. Return ──────────────────────────────────────────────────────
    return { video_url: videoUrl, seed: seed != null ? String(seed) : undefined };
  },
});
