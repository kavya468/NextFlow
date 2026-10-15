// ============================================================================
// src/trigger/seedream.ts — Seedream 4.5 Trigger.dev Task
// ============================================================================
//
// Executes fal.ai's Seedream 4.5 model via the webhook/waitpoint pattern:
//   1. Create a waitpoint token
//   2. Build HMAC-signed webhook URL
//   3. POST to fal.ai REST API with webhook_url (queue the job)
//   4. wait.forToken() — task pauses until fal.ai POSTs back
//   5. Zod-validate the nested response (payload.images[0].url)
//   6. Return { image_url }
//
// ENDPOINT SELECTION:
//   image_url in payload → fal-ai/bytedance/seedream/v4.5/edit
//   no image_url         → fal-ai/bytedance/seedream/v4.5/text-to-image
//
// ERROR HANDLING:
//   - fal.ai non-200 on initial POST → throw with status + body
//   - fal.ai returns unexpected shape → throw "Invalid provider response"
//   - wait.forToken() times out (5min) → throw "Provider timeout"
//   - All errors are descriptive — the orchestrator marks NodeRun FAILED
// ============================================================================

import { logger, task, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { buildWebhookUrl, assertFalRequestId } from "../../lib/webhook-signing";

// ── fal.ai API configuration ────────────────────────────────────────────────

const FAL_BASE_URL = "https://queue.fal.run";
const FAL_GENERATE_ENDPOINT = "fal-ai/bytedance/seedream/v4.5/text-to-image";
const FAL_EDIT_ENDPOINT = "fal-ai/bytedance/seedream/v4.5/edit";
const FAL_REQUEST_TIMEOUT_MS = 10_000;
const WAITPOINT_TIMEOUT = "5m";

// ── Zod schemas ─────────────────────────────────────────────────────────────

const taskInputSchema = z.object({
  mode: z.enum(["generate", "edit"]).default("generate"),
  prompt: z.string().min(1, "Prompt is required"),
  // FIX: Limit array inputs to max 10 for image editing
  image_urls: z.union([z.string(), z.array(z.string()).max(10)]).optional(),
  // FIX: Removed default "square_hd" to respect API fallback
  image_size: z.string().optional(),
  seed: z.coerce.number().optional(),
  // FIX: Added missing input validation with coercion
  num_images: z.coerce.number().min(1).max(6).optional(),
  max_images: z.coerce.number().min(1).max(6).optional(),
  enable_safety_checker: z.boolean().optional(),
});

const falQueueResponseSchema = z.object({
  request_id: z.string().min(1),
  status: z.string().optional(),
  queue_position: z.number().optional(),
});

const falWebhookSuccessSchema = z.object({
  request_id: z.string().min(1),
  status: z.literal("OK"),
  payload: z.object({
    images: z
      .array(
        z.object({
          url: z.string().url(),
          width: z.number().optional(),
          height: z.number().optional(),
          content_type: z.string().optional(),
          // FIX: Add missing output metadata fields
          file_name: z.string().optional(),
          file_size: z.number().optional(),
        })
      )
      .min(1),
    // FIX: Only Text-to-Image returns seed according to OpenAPI schema
    seed: z.number().optional(),
    timings: z.record(z.string(), z.number()).optional(),
  }),
});

const falWebhookErrorSchema = z.object({
  request_id: z.string().min(1),
  status: z.literal("ERROR"),
  error: z.string(),
});

// ── Task definition ─────────────────────────────────────────────────────────

export const seedreamTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "seedream-4.5",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: {
    mode?: "generate" | "edit";
    prompt: string;
    image_urls?: string | string[];
    image_size?: string;
    seed?: number;
    // FIX: Add mapped arguments 
    num_images?: number;
    max_images?: number;
    enable_safety_checker?: boolean;
  }) => {
    logger.info("Starting Seedream 4.5 generation", {
      mode: payload.mode,
      hasImageUrl: !!payload.image_urls,
      imageSize: payload.image_size,
    });

    // ── 1. Validate input ─────────────────────────────────────────────────
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Input validation failed", { issues });
      throw new Error(`Seedream input validation failed: ${issues}`);
    }
    const input = inputResult.data;

    // ── 2. Select fal.ai endpoint ─────────────────────────────────────────
    const isEditMode = input.mode === "edit";
    const falEndpoint = isEditMode ? FAL_EDIT_ENDPOINT : FAL_GENERATE_ENDPOINT;

    // Edit endpoint requires image_urls per fal.ai OpenAPI spec
    if (isEditMode && !input.image_urls) {
      throw new Error(
        "Seedream edit mode requires at least one image_urls input. " +
          "Connect an image source to the Seedream node or switch to generate mode."
      );
    }

    logger.info("Endpoint selected", {
      mode: input.mode,
      endpoint: falEndpoint,
    });

    // ── 3. Create waitpoint token ─────────────────────────────────────────
    const token = await wait.createToken({
      timeout: WAITPOINT_TIMEOUT,
      tags: ["seedream-4.5", isEditMode ? "edit" : "generate"],
    });

    logger.info("Waitpoint token created", {
      tokenId: token.id,
      isCached: token.isCached,
    });

    // ── 4. Build HMAC-signed webhook URL ──────────────────────────────────
    const webhookUrl = buildWebhookUrl(token.id);

    // ── 5. Build fal.ai request body ──────────────────────────────────────
    const falBody: Record<string, unknown> = {
      prompt: input.prompt,
      webhook_url: webhookUrl,
    };

    // FIX: Only add image_size if specified. Otherwise let the API use the default
    if (input.image_size) {
      falBody.image_size = input.image_size;
    }

    // FIX: Dynamic assignment instead of hardcoding 'num_images' and 'enable_safety_checker'
    if (input.num_images !== undefined) {
      falBody.num_images = input.num_images;
    }
    
    if (input.max_images !== undefined) {
      falBody.max_images = input.max_images;
    }

    if (input.enable_safety_checker !== undefined) {
      falBody.enable_safety_checker = input.enable_safety_checker;
    } else {
      falBody.enable_safety_checker = true;
    }

    // Only attach seed if the user provided one
    if (input.seed !== undefined && input.seed !== null) {
      falBody.seed = input.seed;
    }

    // Only attach images if we are explicitly in edit mode
    if (input.mode === "edit" && input.image_urls) {
      falBody.image_urls = Array.isArray(input.image_urls)
        ? input.image_urls
        : [input.image_urls];
    }

    // ── 6. POST to fal.ai queue endpoint (10s timeout) ───────────────────
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      throw new Error(
        "FAL_KEY environment variable is not set. " +
          "Add your fal.ai API key to your Trigger.dev environment variables."
      );
    }

    const falUrl = `${FAL_BASE_URL}/${falEndpoint}`;
    logger.info("Sending request to fal.ai", { url: falUrl });

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

    // ── 7. Handle non-200 from fal.ai queue endpoint ─────────────────────
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

    // ── 8. Validate queue response ────────────────────────────────────────
    let queueData: unknown;
    try {
      queueData = await queueResponse.json();
    } catch {
      throw new Error("fal.ai returned 200 but response is not valid JSON");
    }

    const queueResult = falQueueResponseSchema.safeParse(queueData);
    if (!queueResult.success) throw new Error("Provider queue response has no valid request ID");
    if (!queueResult.success) {
      logger.warn("fal.ai queue response has unexpected shape", {
        raw: JSON.stringify(queueData).slice(0, 500),
      });
    } else {
      logger.info("Job queued successfully", {
        requestId: queueResult.data.request_id,
        queuePosition: queueResult.data.queue_position,
      });
    }

    // ── 9. Wait for webhook callback (5min timeout) ──────────────────────
    logger.info("Waiting for fal.ai callback...", {
      timeout: WAITPOINT_TIMEOUT,
    });

    const waitResult = await wait.forToken<unknown>(token);

    if (!waitResult.ok) {
      throw new Error(
        "Provider timeout: fal.ai did not respond within 5 minutes. " +
          "The image generation may still be processing on fal.ai's side. " +
          "Try again or check fal.ai's status page."
      );
    }

    const webhookPayload = waitResult.output;
    assertFalRequestId(webhookPayload, queueResult.data.request_id);

    logger.info("Webhook payload received", {
      status: (webhookPayload as Record<string, unknown>)?.status,
    });

    // ── 10. Check for fal.ai error response ──────────────────────────────
    const errorResult = falWebhookErrorSchema.safeParse(webhookPayload);
    if (errorResult.success) {
      throw new Error(
        `fal.ai generation failed: ${errorResult.data.error}`
      );
    }

    // ── 11. Validate successful response ─────────────────────────────────
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

    const imageUrl = successResult.data.payload.images[0].url;

    logger.info("Seedream generation complete", {
      imageUrl: imageUrl.slice(0, 80) + "...",
      seed: successResult.data.payload.seed,
    });

    // ── 12. Return the result ────────────────────────────────────────────
    // FIX: Ensure all mapped outputs are returned correctly
    return { 
      image_url: imageUrl,
      image_urls: successResult.data.payload.images.map(image => image.url),
      generatedImageCount: successResult.data.payload.images.length,
    };
  },
});
