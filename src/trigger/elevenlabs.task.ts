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

import { logger, task, wait } from "@trigger.dev/sdk/v3";
import { z } from "zod";
import { buildWebhookUrl } from "../../lib/webhook-signing";

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
  inputs: z
    .union([
      z.array(dialogueBlockSchema).min(1, "At least one input block is required"),
      z.string().min(1, "Input text is required"),
    ])
    .transform((val) =>
      typeof val === "string" ? parseInputsString(val) : val,
    ),
  stability: z.number().min(0).max(1).optional(),
  use_speaker_boost: z.boolean().optional(),
  language_code: z.string().optional(),
  seed: z.number().int().optional(),
  pronunciation_dictionary_locators: z.string().optional(),
});

// fal.ai queue response shape
const falQueueResponseSchema = z.object({
  request_id: z.string(),
  status: z.string().optional(),
  queue_position: z.number().optional(),
});

// Webhook success payload — fal.ai wraps the output in `payload`
const falWebhookSuccessSchema = z.object({
  request_id: z.string(),
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
  request_id: z.string(),
  status: z.literal("ERROR"),
  error: z.string(),
});

// ── Smart Input Parser ──────────────────────────────────────────────────────
// Converts various string formats into the required [{text, voice}] array.
//
// SUPPORTED FORMATS (in order of detection):
//
// 1. JSON Array (already correct):
//    [{"text": "Hello!", "voice": "Rachel"}, {"text": "Hi!", "voice": "Adam"}]
//
// 2. "Speaker: dialogue" lines (colon-separated):
//    Rachel: Hello, how are you?
//    Adam: I'm doing great, thanks!
//
// 3. "SPEAKER\ndialogue" blocks (name on its own line, dialogue below):
//    Rachel
//    Hello, how are you?
//
//    Adam
//    I'm doing great, thanks!
//
// 4. Plain text (fallback — assigned to "default" voice):
//    Hello, this is a simple text to speak.
//
// The default voice name "default" tells the API to use ElevenLabs' default.
// Users can override this later in the UI or by connecting to dialogue handles.

const DEFAULT_VOICE = "default";

function parseInputsString(
  raw: string
): { text: string; voice: string }[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // ── Strategy 1: Try JSON parse ──────────────────────────────────────────
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        Array.isArray(parsed) &&
        parsed.length > 0 &&
        parsed.every(
          (item: any) =>
            typeof item === "object" &&
            item !== null &&
            typeof item.text === "string" &&
            typeof item.voice === "string"
        )
      ) {
        return parsed as { text: string; voice: string }[];
      }
    } catch {
      // Not valid JSON — fall through to text parsing
    }
  }

  // ── Strategy 2: "Speaker: dialogue" lines ───────────────────────────────
  // Matches lines like "Rachel: Hello there!" or "Adam: How are you?"
  // A speaker name is 1-40 chars of letters, spaces, hyphens, or underscores
  const colonLineRegex = /^([A-Za-z][A-Za-z0-9 _-]{0,39}):\s*(.+)$/;
  const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  const colonMatches = lines
    .map((line) => colonLineRegex.exec(line))
    .filter((m): m is RegExpExecArray => m !== null);

  // If at least half the non-empty lines match "Speaker: text", use this strategy
  if (colonMatches.length > 0 && colonMatches.length >= lines.length * 0.5) {
    return colonMatches.map((m) => ({
      text: m[2].trim(),
      voice: m[1].trim(),
    }));
  }

  // ── Strategy 3: "SPEAKER\ndialogue" blocks (separated by blank lines) ──
  // Split on double newlines to get blocks. Each block's first line is the
  // speaker name, remaining lines are the dialogue text.
  const blocks = trimmed.split(/\n\s*\n/).filter(Boolean);
  if (blocks.length >= 2) {
    const nameOnlyRegex = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;
    const blockResults: { text: string; voice: string }[] = [];
    let allBlocksMatch = true;

    for (const block of blocks) {
      const blockLines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (blockLines.length >= 2 && nameOnlyRegex.test(blockLines[0])) {
        blockResults.push({
          voice: blockLines[0],
          text: blockLines.slice(1).join(" ").trim(),
        });
      } else {
        allBlocksMatch = false;
        break;
      }
    }

    if (allBlocksMatch && blockResults.length > 0) {
      return blockResults;
    }
  }

  // ── Strategy 4: Plain text fallback ─────────────────────────────────────
  // Treat each non-empty line as a separate dialogue entry with "default" voice.
  // If it's a single block of text, return it as one entry.
  const nonEmptyLines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
  if (nonEmptyLines.length === 1) {
    return [{ text: nonEmptyLines[0], voice: DEFAULT_VOICE }];
  }

  // Multiple lines without speaker attribution → each line is one entry
  return nonEmptyLines.map((line) => ({
    text: line,
    voice: DEFAULT_VOICE,
  }));
}

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

    // 1. Smart-parse inputs from various formats
    let parsedPayload = {
      ...payload,
      inputs: Array.isArray(payload.inputs) ? payload.inputs : undefined
    } as any;

    if (typeof payload.inputs === 'string') {
      // ── Smart string parsing ────────────────────────────────────────────
      // Upstream nodes (LLMs, Text nodes) may send a plain string.
      // Parse it into the required [{text, voice}] array format.
      const parsed = parseInputsString(payload.inputs);
      if (parsed.length === 0) {
        throw new Error(
          "Failed to parse inputs string. The input was empty or could not be " +
          "converted to dialogue blocks. See the supported formats:\n" +
          '  • JSON: [{"text": "Hello", "voice": "Rachel"}]\n' +
          "  • Script: Rachel: Hello there!\n" +
          "  • Plain text: Hello there! (uses default voice)"
        );
      }
      parsedPayload.inputs = parsed;
      logger.info("Smart-parsed string inputs into dialogue blocks", {
        blockCount: parsed.length,
        voices: [...new Set(parsed.map((b) => b.voice))],
      });
    }

    // ── Merge dynamic dialogue_text_X handles ────────────────────────────
    // When users connect Text nodes to individual dialogue line handles
    // (dialogue_text_0, dialogue_text_1, ...), the orchestrator injects
    // these values into the payload. Here we merge them into the parsed
    // inputs array, overriding the manual text for each connected line.
    if (Array.isArray(parsedPayload.inputs)) {
      for (const key of Object.keys(payload)) {
        const match = key.match(/^dialogue_text_(\d+)$/);
        if (match && payload[key] !== undefined && payload[key] !== null && payload[key] !== "") {
          const index = parseInt(match[1], 10);
          if (index < parsedPayload.inputs.length) {
            parsedPayload.inputs[index] = {
              ...parsedPayload.inputs[index],
              text: String(payload[key]),
            };
            logger.info(`Merged connected text for dialogue line ${index}`, {
              handleKey: key,
              textLength: String(payload[key]).length,
            });
          }
        }
      }
    }

    const inputResult = taskInputSchema.safeParse(parsedPayload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      logger.error("Input validation failed", { issues });
      throw new Error(`ElevenLabs input validation failed: ${issues}`);
    }
    const input = inputResult.data;

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
    };
  },
});
