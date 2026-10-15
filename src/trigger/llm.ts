import { publicFetch } from "../../lib/safe-fetch";
import { logger, task } from "@trigger.dev/sdk";
import { GoogleGenerativeAI, type Part } from "@google/generative-ai";
import { validateLlmBillingInputs } from "../../lib/credits/billing-policy";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const generateLlmContent = task({
  machine: {
    preset: "large-2x",
  },
  id: "generate-llm-content",
  // Never replay a whole paid task after an ambiguous provider outcome.
  // The bounded retry below handles explicit rate-limit rejections only.
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: {
    model?: string;
    systemPrompt?: string;
    userMessage?: string;
    images?: string[];
    max_tokens?: number;
    temperature?: number;
  }) => {
    validateLlmBillingInputs("llm", {
      model: payload.model,
      user_message: payload.userMessage,
      system_prompt: payload.systemPrompt,
      images: payload.images,
      max_tokens: payload.max_tokens,
    });
    logger.info("Starting Gemini LLM generation", { model: payload.model });

    // ── Payload Validation ──────────────────────────────────────────────
    if (!payload.userMessage || typeof payload.userMessage !== "string" || payload.userMessage.trim() === "") {
      logger.error("Missing or empty userMessage in payload");
      throw new Error(
        "LLM generation failed: A non-empty user message is required. " +
        "Ensure the 'User Message' input is connected or has a value."
      );
    }

    // ── Sanitize images array ───────────────────────────────────────────
    // Strip undefined/null/empty entries that leak through from unconnected
    // multi-input handles — prevents PrismaClientValidationError downstream.
    const sanitizedImages = (payload.images ?? []).filter(
      (img): img is string => typeof img === "string" && img.trim() !== ""
    );

    // ── Model Resolution ────────────────────────────────────────────────
    let actualModel = payload.model || "gemini-2.5-flash";
    if (["gemini-1.5-pro", "gemini-pro", "default"].includes(actualModel)) {
      actualModel = "gemini-2.5-flash";
    } else if (["gemini-1.5-flash", "gemini-flash"].includes(actualModel)) {
      actualModel = "gemini-2.5-flash";
    }

    const model = genAI.getGenerativeModel({
      model: actualModel,
      ...(payload.systemPrompt && { systemInstruction: payload.systemPrompt }),
      generationConfig: {
        maxOutputTokens: payload.max_tokens ?? 2048,
        ...(payload.temperature !== undefined && { temperature: payload.temperature }),
      },
    });

    const parts: Part[] = [{ text: payload.userMessage }];

    // ── Multimodal vision support ─────────────────────────────────────
    for (const [index, imageUrl] of sanitizedImages.entries()) {
      try {
        logger.info("Fetching image for vision support", { imageNumber: index + 1 });
        const response = await publicFetch(imageUrl, { maxBytes: 20 * 1024 * 1024 });
        if (!response.ok) {
          throw new Error("Image download was rejected");
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        parts.push({
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: response.headers.get("content-type") || "image/jpeg",
          },
        });
      } catch {
        // Image URLs and download errors can contain signed credentials.
        // Fail before generation instead of silently changing the requested input.
        throw new Error(`Failed to load vision image ${index + 1}. Check that the image is accessible.`);
      }
    }

    // ── Gemini API Call with In-Task Retry ───────────────────────────────
    // Only explicit 429 rejections may be retried, up to three total calls.
    // A 5xx or transport failure can follow billable work and must not be replayed.
    const MAX_API_RETRIES = 3;
    const BASE_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_API_RETRIES; attempt++) {
      try {
        logger.info(`Sending request to Gemini API (attempt ${attempt}/${MAX_API_RETRIES})...`);
        const result = await model.generateContent(parts);
        const response = await result.response;
        const text = response.text();

        logger.info("Successfully generated content", {
          outputLength: text.length,
          attempt,
        });
        const usage = response.usageMetadata;
        return {
          text,
          ...(usage && {
            usage: {
              prompt_tokens: usage.promptTokenCount,
              // total includes reasoning tokens omitted from candidatesTokenCount.
              completion_tokens: Math.max(usage.candidatesTokenCount, usage.totalTokenCount - usage.promptTokenCount),
            },
          }),
        };
      } catch (error: unknown) {
        const statusCode = typeof error === "object" && error !== null
          ? "status" in error && typeof error.status === "number" ? error.status
            : "httpStatusCode" in error && typeof error.httpStatusCode === "number" ? error.httpStatusCode : 0
          : 0;
        const isRetryable = statusCode === 429;

        logger.error(`Gemini API call failed (attempt ${attempt}/${MAX_API_RETRIES})`, {
          errorType: error instanceof Error ? error.name : "UnknownError",
          status: statusCode,
          retryable: isRetryable,
        });

        // Every other failure ends this attempt without another provider call.
        if (!isRetryable || attempt === MAX_API_RETRIES) {
          throw error;
        }

        // Exponential backoff capped at 60s
        const delay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), 60000);
        logger.info(`Retrying in ${delay / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // TypeScript exhaustiveness — should never reach here
    throw new Error("Exhausted all Gemini API retry attempts");
  },
});
