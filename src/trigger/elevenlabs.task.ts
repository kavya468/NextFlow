// ============================================================================
// src/trigger/elevenlabs.task.ts — ElevenLabs Text-to-Dialogue V3 Task
// ============================================================================
//
// Trigger.dev task that calls fal.ai's ElevenLabs text-to-dialogue endpoint.
//
// Endpoint: POST https://queue.fal.run/fal-ai/elevenlabs/text-to-dialogue/eleven-v3
//
// INPUT (from orchestrator, flat keys):
//   inputs:            array of DialogueBlock objects
//   stability?:        number   — 0, 0.5, or 1
//   use_speaker_boost?: boolean
//   language_code?:    string   — ISO 639-1
//   seed?:             number   — numeric seed (fixed from string)
//   pronunciation_dictionary_locators?: string — JSON string of array
//
// fal.ai REQUEST BODY (per OpenAPI schema):
//   {
//     inputs: [{ text: string, voice: string }, ...],
//     stability?: number | null,
//     use_speaker_boost?: boolean | null,
//     language_code?: string | null,
//     seed?: number | null,
//     pronunciation_dictionary_locators?: []
//   }
//
// OUTPUT:
//   { audio_url: string, seed: number }
// ============================================================================

import { logger, task, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { buildWebhookUrl, assertFalRequestId } from "../../lib/webhook-signing";
import { validateDialogueBillingInputs } from "../../lib/credits/billing-policy";
import { composeDialogueInputs } from "../../lib/nodes/structured-inputs";

const FAL_BASE_URL = "https://queue.fal.run";
const FAL_ENDPOINT = "fal-ai/elevenlabs/text-to-dialogue/eleven-v3";
const FAL_REQUEST_TIMEOUT_MS = 10_000;
const WAITPOINT_TIMEOUT = "5m";

// A single dialogue block per the OpenAPI schema
const dialogueBlockSchema = z.object({
  text: z.string(),
  voice: z.string()
});

// FIX: Schema for pronunciation dictionary locator objects — validates parsed items
const pronunciationDictionaryLocatorSchema = z.object({
  id: z.string(),
  version_id: z.string(),
});

// Input schema — matches what the orchestrator sends (flat keys).
// The `inputs` field accepts either:
//   - Array of {text, voice} blocks (from UI dialogue editor)
//   - A raw string (from upstream LLM/Text nodes — smart-parsed at runtime)
const taskInputSchema = z.object({
  inputs: z.array(dialogueBlockSchema).min(1, "At least one input block is required"),
  stability: z.number().min(0).max(1).optional(),
  use_speaker_boost: z.boolean().optional(),
  language_code: z.string().optional(),
  seed: z.number().int().optional(),
  pronunciation_dictionary_locators: z.string().optional(),
});

// fal.ai queue response shape
const falQueueResponseSchema = z.object({
  request_id: z.string().min(1),
  status: z.string().optional(),
  queue_position: z.number().optional(),
});

// Webhook success payload — fal.ai wraps the output in `payload`
const falWebhookSuccessSchema = z.object({
  request_id: z.string().min(1),
  status: z.literal("OK"),
  payload: z.object({
    audio: z.object({
      url: z.string().url(),
      content_type: z.string().optional(),
      file_name: z.string().optional(),
      file_size: z.number().optional(),
    }),
    // FIX: seed is required in the API output schema, not optional
    seed: z.number(),
  }),
});

const falWebhookErrorSchema = z.object({
  request_id: z.string().min(1),
  status: z.literal("ERROR"),
  error: z.string(),
});

// ── Task definition ─────────────────────────────────────────────────────────

export const elevenlabsTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "elevenlabs-generate",
  retry: { maxAttempts: 1 },

  run: async (payload: {
    inputs: { text: string, voice: string }[] | string;
    stability?: number;
    use_speaker_boost?: boolean;
    language_code?: string;
    seed?: number;
    pronunciation_dictionary_locators?: string;
    // Dynamic handle keys — dialogue_text_0, dialogue_text_1, etc.
    // Injected by the orchestrator when Text nodes connect to per-line handles.
    [key: string]: unknown;
  }) => {
    logger.info("Starting ElevenLabs Text-to-Dialogue generation", {
      blocksCount: typeof payload.inputs === 'object' ? payload.inputs?.length : 'string-input',
      inputType: typeof payload.inputs,
    });

    // Use the same composition rules as the worker before provider admission.
    const parsedPayload = { ...payload, inputs: composeDialogueInputs(payload) };

    const inputResult = taskInputSchema.safeParse(parsedPayload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Input validation failed", { issues });
      throw new Error(`ElevenLabs input validation failed: ${issues}`);
    }
    const input = inputResult.data;
    validateDialogueBillingInputs({ inputs: input.inputs });

    logger.info("Parsed dialogue blocks", {
      count: input.inputs.length,
      voices: [...new Set(input.inputs.map((b) => b.voice))],
    });

    // 3. Create waitpoint token
    const token = await wait.createToken({
      timeout: WAITPOINT_TIMEOUT,
      tags: ["elevenlabs-tts"],
    });
    logger.info("Waitpoint token created", { tokenId: token.id });

    // 4. Build HMAC-signed webhook URL
    const webhookUrl = buildWebhookUrl(token.id);

    // 5. Build fal.ai request body — matches OpenAPI schema exactly
    //    Required: inputs (DialogueBlock[])
    //    Optional: stability, use_speaker_boost, language_code, seed, pronunciation_dictionary_locators
    const falBody: Record<string, unknown> = {
      // FIX: pass inputs array directly
      inputs: input.inputs,
      webhook_url: webhookUrl,
    };

    if (input.stability !== undefined) {
      // Schema says: must be one of 0.0, 0.5, 1.0 — round to nearest
      const validValues = [0, 0.5, 1];
      const rounded = validValues.reduce((prev, curr) =>
        Math.abs(curr - input.stability!) < Math.abs(prev - input.stability!)
          ? curr
          : prev
      );
      falBody.stability = rounded;
    }
    if (input.use_speaker_boost !== undefined) {
      falBody.use_speaker_boost = input.use_speaker_boost;
    }
    if (input.language_code) {
      falBody.language_code = input.language_code;
    }
    if (input.seed !== undefined) {
      falBody.seed = input.seed;
    }

    if (input.pronunciation_dictionary_locators) {
      try {
        const parsedLocators = JSON.parse(input.pronunciation_dictionary_locators);
        if (Array.isArray(parsedLocators)) {
          // FIX: validate each locator object has required id and version_id fields
          const validatedLocators = z.array(pronunciationDictionaryLocatorSchema).max(3).safeParse(parsedLocators);
          if (validatedLocators.success) {
            falBody.pronunciation_dictionary_locators = validatedLocators.data;
          } else {
            logger.warn("pronunciation_dictionary_locators items have invalid shape, ignoring", {
              issues: validatedLocators.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "),
            });
          }
        } else {
          logger.warn("pronunciation_dictionary_locators is not an array, ignoring");
        }
      } catch (err) {
        logger.warn("Failed to parse pronunciation_dictionary_locators JSON, ignoring", { error: err });
      }
    }

    // 6. POST to fal.ai queue
    const falApiKey = process.env.FAL_KEY;
    if (!falApiKey) {
      throw new Error(
        "FAL_KEY environment variable is not set. " +
        "Add your fal.ai API key to your Trigger.dev environment variables."
      );
    }

    const falUrl = `${FAL_BASE_URL}/${FAL_ENDPOINT}`;
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
          `fal.ai connection timeout: Initial request to ${FAL_ENDPOINT} ` +
          `did not respond within ${FAL_REQUEST_TIMEOUT_MS / 1000}s`
        );
      }
      throw new Error(
        `fal.ai network error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // 7. Handle non-200
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

    // 8. Validate queue response
    let queueData: unknown;
    try {
      queueData = await queueResponse.json();
    } catch {
      throw new Error("fal.ai returned 200 but response is not valid JSON");
    }

    const queueResult = falQueueResponseSchema.safeParse(queueData);
    if (!queueResult.success) throw new Error("Provider queue response has no valid request ID");
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

    // 9. Wait for webhook callback
    logger.info("Waiting for fal.ai callback...", {
      timeout: WAITPOINT_TIMEOUT,
    });
    const waitResult = await wait.forToken<unknown>(token);

    if (!waitResult.ok) {
      throw new Error(
        "Provider timeout: fal.ai did not respond within 5 minutes. " +
        "The audio generation may still be processing. Try again or check fal.ai status."
      );
    }

    const webhookPayload = waitResult.output;
    assertFalRequestId(webhookPayload, queueResult.data.request_id);
    logger.info("Webhook payload received", {
      status: (webhookPayload as Record<string, unknown>)?.status,
    });

    // 10. Check for error response
    const errorResult = falWebhookErrorSchema.safeParse(webhookPayload);
    if (errorResult.success) {
      throw new Error(
        `fal.ai generation failed: ${errorResult.data.error}`
      );
    }

    // 11. Validate successful response
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
        "fal.ai returned 200 but the response did not match the expected schema."
      );
    }

    const audioUrl = successResult.data.payload.audio.url;
    logger.info("ElevenLabs Text-to-Dialogue generation complete", {
      audioUrl: audioUrl.slice(0, 80) + "...",
      seed: successResult.data.payload.seed,
    });

    // 12. Return result
    // FIX: seed is required in the API output — return it unconditionally
    return {
      audio_url: audioUrl,
      seed: successResult.data.payload.seed,
      billableCharacters: input.inputs.reduce((sum, line) => sum + Array.from(line.text).length, 0),
    };
  },
});
