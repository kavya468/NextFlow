import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { buildWebhookUrl } from "../../lib/webhook-signing";

const FAL_BASE_URL = "https://queue.fal.run";
const FAL_REFERENCE_ENDPOINT =
  "fal-ai/kling-video/o1/video-to-video/reference";
const FAL_EDIT_ENDPOINT = "fal-ai/kling-video/o1/video-to-video/edit";
const FAL_REQUEST_TIMEOUT_MS = 15_000;
const WAITPOINT_TIMEOUT = "10m";

const taskInputSchema = z.object({
  mode: z.enum(["reference", "edit"]),
  prompt: z.string().min(1, "Prompt is required"),
  video_url: z.string().url("Valid video URL is required"),
  image_urls: z.union([z.string(), z.array(z.string())]).optional(),
  elements: z
    .array(
      z.object({
        frontal_image_url: z.string().optional().default(""),
        reference_image_urls: z.array(z.string()).optional().default([]),
      })
    )
    .optional()
    .default([]),
  keep_audio: z.boolean().optional().default(false),
  aspect_ratio: z
    .enum(["auto", "16:9", "9:16", "1:1"])
    .optional()
    .default("auto"),
  duration: z.enum(["3", "4", "5", "6", "7", "8", "9", "10"]).optional().default("5"),
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
  }),
});

const falWebhookErrorSchema = z.object({
  request_id: z.string(),
  status: z.literal("ERROR"),
  error: z.string(),
});

export const klingTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "kling-generate",
  retry: { maxAttempts: 1 },

  run: async (payload: {
    mode: string;
    prompt: string;
    video_url: string;
    image_urls?: string | string[];
    elements?: Array<{ frontal_image_url: string; reference_image_urls: string[] }>;
    keep_audio?: boolean;
    aspect_ratio?: string;
    duration?: string;
  }) => {
    logger.info("Starting Kling O1 video generation", {
      mode: payload.mode,
      hasImageUrls: !!payload.image_urls,
      elementCount: Array.isArray(payload.elements) ? payload.elements.length : 0,
    });

    // ── 1. Validate input ───────────────────────────────────────────────
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Input validation failed", { issues });
      throw new Error(`Kling input validation failed: ${issues}`);
    }
    const input = inputResult.data;

    // ── 2. Select fal.ai endpoint ───────────────────────────────────────
    const isEditMode = input.mode === "edit";
    const falEndpoint = isEditMode
      ? FAL_EDIT_ENDPOINT
      : FAL_REFERENCE_ENDPOINT;

    logger.info("Endpoint selected", {
      mode: input.mode,
      endpoint: falEndpoint,
    });

    // ── 3. Create waitpoint token ───────────────────────────────────────
    const token = await wait.createToken({
      timeout: WAITPOINT_TIMEOUT,
      tags: ["kling-o1", input.mode],
    });

    logger.info("Waitpoint token created", {
      tokenId: token.id,
      isCached: token.isCached,
    });

    // ── 4. Build HMAC-signed webhook URL ────────────────────────────────
    const webhookUrl = buildWebhookUrl(token.id);

    // ── 5. Build fal.ai request body ────────────────────────────────────
    let finalImageUrls = Array.isArray(input.image_urls)
      ? input.image_urls
      : input.image_urls
        ? [input.image_urls]
        : [];

    // Elements array comes directly from the compound ElementsEditor.
    // Each element = { frontal_image_url, reference_image_urls[] }
    // which maps to OmniVideoElementInput in the Fal.ai API.
    let finalElements = (input.elements || [])
      .map((el) => {
        const payloadElement: Record<string, any> = {};
        if (el.frontal_image_url) {
          payloadElement.frontal_image_url = el.frontal_image_url;
        }
        if (el.reference_image_urls && el.reference_image_urls.length > 0) {
          const refs = el.reference_image_urls.filter(Boolean);
          if (refs.length > 0) {
            payloadElement.reference_image_urls = refs;
          }
        }
        return payloadElement;
      })
      .filter((el) => Object.keys(el).length > 0);

    // Enforce Fal.ai max 4 limit (elements + image_urls) by slicing
    if (finalElements.length + finalImageUrls.length > 4) {
      logger.warn("Soft limiting total elements and image_urls to 4", {
        elementsCount: finalElements.length,
        imageUrlsCount: finalImageUrls.length,
      });
      if (finalElements.length > 4) {
        finalElements = finalElements.slice(0, 4);
      }
      const remainingSlots = 4 - finalElements.length;
      if (finalImageUrls.length > remainingSlots) {
        finalImageUrls = finalImageUrls.slice(0, remainingSlots);
      }
    }

    // Base payload (shared by both Reference and Edit modes)
    const falBody: Record<string, unknown> = {
      prompt: input.prompt || "",
      video_url: input.video_url || "",
      webhook_url: webhookUrl,
      image_urls: finalImageUrls,
      elements: finalElements,
      keep_audio: Boolean(input.keep_audio),
    };

    // Reference mode only: aspect_ratio and duration
    // (Edit endpoint does NOT accept these parameters)
    if (!isEditMode) {
      falBody.aspect_ratio = input.aspect_ratio
        ? String(input.aspect_ratio).toLowerCase()
        : "auto";
      falBody.duration = input.duration
        ? String(input.duration).replace(/\D/g, '')
        : "5";
    }

    // ── 6. POST to fal.ai queue endpoint ────────────────────────────────
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      throw new Error(
        "FAL_KEY environment variable is not set. " +
          "Add your fal.ai API key to your Trigger.dev environment variables."
      );
    }

    const falUrl = `${FAL_BASE_URL}/${falEndpoint}`;
    logger.info("Sending request to fal.ai", { url: falUrl, body: falBody });

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

    // ── 7. Handle non-200 ───────────────────────────────────────────────
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

    // ── 8. Validate queue response ──────────────────────────────────────
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

    // ── 9. Wait for webhook callback (10min timeout) ────────────────────
    logger.info("Waiting for fal.ai callback...", {
      timeout: WAITPOINT_TIMEOUT,
    });

    const waitResult = await wait.forToken<unknown>(token);

    if (!waitResult.ok) {
      throw new Error(
        "Provider timeout: fal.ai did not respond within 10 minutes. " +
          "Video generation may still be processing on fal.ai's side. " +
          "Try again or check fal.ai's status page."
      );
    }

    const webhookPayload = waitResult.output;

    logger.info("Webhook payload received", {
      status: (webhookPayload as Record<string, unknown>)?.status,
    });

    // ── 10. Check for fal.ai error response ─────────────────────────────
    const errorResult = falWebhookErrorSchema.safeParse(webhookPayload);
    if (errorResult.success) {
      throw new Error(
        `fal.ai generation failed: ${errorResult.data.error}`
      );
    }

    // ── 11. Validate successful response ────────────────────────────────
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

    logger.info("Kling O1 generation complete", {
      videoUrl: videoUrl.slice(0, 80) + "...",
    });

    // ── 12. Return ──────────────────────────────────────────────────────
    return { video_url: videoUrl };
  },
});
