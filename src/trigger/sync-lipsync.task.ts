// ============================================================================
// src/trigger/sync-lipsync.task.ts — Sync Lipsync Trigger.dev Task
// ============================================================================
//
// Executes fal.ai's sync-lipsync model via the webhook/waitpoint pattern:
//   1. Zod-validate inputs
//   2. Create a waitpoint token
//   3. Build HMAC-signed webhook URL
//   4. POST to fal.ai queue endpoint with webhook_url
//   5. wait.forToken() — task pauses until fal.ai POSTs back
//   6. Zod-validate the webhook payload (payload.video.url)
//   7. Return { video_url }
//
// TIMEOUT: 10 minutes — lipsync processing is computationally expensive
// ============================================================================

import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { buildWebhookUrl, assertFalRequestId } from "../../lib/webhook-signing";

// ── fal.ai API configuration ────────────────────────────────────────────────

const FAL_BASE_URL = "https://queue.fal.run";
const FAL_ENDPOINT = "fal-ai/sync-lipsync";
const FAL_REQUEST_TIMEOUT_MS = 10_000;
const WAITPOINT_TIMEOUT = "10m";

// ── Zod schemas ─────────────────────────────────────────────────────────────

const taskInputSchema = z.object({
  video_url: z.string().url("video_url must be a valid URL"),
  audio_url: z.string().url("audio_url must be a valid URL"),
  model: z
    .enum(["lipsync-1.9.0-beta", "lipsync-1.8.0", "lipsync-1.7.1"])
    .optional(),
  sync_mode: z
    .enum(["cut_off", "loop", "bounce", "silence", "remap"])
    .optional(),
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
    video: z.object({
      url: z.string().url(),
      content_type: z.string().optional(),
      file_name: z.string().optional(),
      file_size: z.number().optional(),
    }),
  }),
});

const falWebhookErrorSchema = z.object({
  request_id: z.string().min(1),
  status: z.literal("ERROR"),
  error: z.string(),
});

// ── Task definition ─────────────────────────────────────────────────────────

export const syncLipsyncTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "sync-lipsync-generate",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: {
    video_url: string;
    audio_url: string;
    model?: string;
    sync_mode?: string;
  }) => {
    logger.info("Starting Sync Lipsync generation", {
      model: payload.model ?? "lipsync-1.9.0-beta",
      syncMode: payload.sync_mode ?? "cut_off",
    });

    // ── 1. Validate input ─────────────────────────────────────────────────
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Input validation failed", { issues });
      throw new Error(`Sync Lipsync input validation failed: ${issues}`);
    }
    const input = inputResult.data;

    // ── 2. Create waitpoint token ─────────────────────────────────────────
    const token = await wait.createToken({
      timeout: WAITPOINT_TIMEOUT,
      tags: ["sync-lipsync", input.model ?? "lipsync-1.9.0-beta"],
    });

    logger.info("Waitpoint token created", {
      tokenId: token.id,
      isCached: token.isCached,
    });

    // ── 3. Build HMAC-signed webhook URL ──────────────────────────────────
    const webhookUrl = buildWebhookUrl(token.id);

    // ── 4. Build fal.ai request body ──────────────────────────────────────
    const falBody: Record<string, unknown> = {
      video_url: input.video_url,
      audio_url: input.audio_url,
      webhook_url: webhookUrl,
    };

    if (input.model) falBody.model = input.model;
    if (input.sync_mode) falBody.sync_mode = input.sync_mode;

    // ── 5. POST to fal.ai queue endpoint ──────────────────────────────────
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      throw new Error(
        "FAL_KEY environment variable is not set. " +
          "Add your fal.ai API key to your Trigger.dev environment variables."
      );
    }

    const falUrl = `${FAL_BASE_URL}/${FAL_ENDPOINT}`;
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
          `fal.ai connection timeout: Initial request to ${FAL_ENDPOINT} ` +
            `did not respond within ${FAL_REQUEST_TIMEOUT_MS / 1000}s`
        );
      }
      throw new Error(
        `fal.ai network error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // ── 6. Handle non-200 from fal.ai queue endpoint ─────────────────────
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

    // ── 7. Validate queue response ────────────────────────────────────────
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

    // ── 8. Wait for webhook callback (10min timeout) ──────────────────────
    logger.info("Waiting for fal.ai callback...", {
      timeout: WAITPOINT_TIMEOUT,
    });

    const waitResult = await wait.forToken<unknown>(token);

    if (!waitResult.ok) {
      throw new Error(
        "Provider timeout: fal.ai did not respond within 10 minutes. " +
          "Lipsync processing may still be running on fal.ai's side. " +
          "Try again or check fal.ai's status page."
      );
    }

    const webhookPayload = waitResult.output;
    assertFalRequestId(webhookPayload, queueResult.data.request_id);

    logger.info("Webhook payload received", {
      status: (webhookPayload as Record<string, unknown>)?.status,
    });

    // ── 9. Check for fal.ai error response ──────────────────────────────
    const errorResult = falWebhookErrorSchema.safeParse(webhookPayload);
    if (errorResult.success) {
      throw new Error(
        `fal.ai lipsync failed: ${errorResult.data.error}`
      );
    }

    // ── 10. Validate successful response ─────────────────────────────────
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

    logger.info("Sync Lipsync generation complete", {
      videoUrl: videoUrl.slice(0, 80) + "...",
    });

    // ── 11. Return the result ────────────────────────────────────────────
    return { video_url: videoUrl };
  },
});
