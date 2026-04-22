import { logger, task } from "@trigger.dev/sdk/v3";
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export const generateLlmContent = task({
  machine: {
    preset: "large-2x",
  },
  id: "generate-llm-content",
  // ── Retry with exponential backoff ────────────────────────────────────
  // Gemini API frequently returns 503 under load. Trigger.dev's built-in
  // retry handles this at the infrastructure level — we never need manual
  // retry loops inside the run() function.
  retry: {
    maxAttempts: 5,
    factor: 2,
    minTimeoutInMs: 2000,
    maxTimeoutInMs: 30000,
  },
  run: async (payload: {
    model?: string;
    systemPrompt?: string;
    userMessage?: string;
    images?: string[];
  }) => {
    logger.info("Starting Gemini LLM generation", { model: payload.model });

    // ── Payload Validation ──────────────────────────────────────────────
    if (!payload.userMessage || typeof payload.userMessage !== "string" || payload.userMessage.trim() === "") {
      logger.error("Missing or empty userMessage in payload", { payload });
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
    });

    const parts: any[] = [{ text: payload.userMessage }];

    // ── Multimodal vision support ─────────────────────────────────────
    for (const imageUrl of sanitizedImages) {
      try {
        logger.info("Fetching image for vision support", { url: imageUrl });
        const response = await fetch(imageUrl);
        if (!response.ok) {
          logger.warn("Failed to fetch vision image, skipping", {
            url: imageUrl,
            status: response.status,
          });
          continue;
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        parts.push({
          inlineData: {
            data: buffer.toString("base64"),
            mimeType: response.headers.get("content-type") || "image/jpeg",
          },
        });
      } catch (imgErr: any) {
        logger.warn("Error processing vision image, skipping", {
          url: imageUrl,
          error: imgErr.message,
        });
      }
    }

    // ── Gemini API Call with In-Task Retry ───────────────────────────────
    // Trigger.dev's task-level retry restarts the ENTIRE run (re-fetches
    // images, re-builds parts). For transient 503/429 errors, an in-task
    // retry is much cheaper — it retries just the generateContent() call.
    const MAX_API_RETRIES = 6;
    const BASE_DELAY_MS = 3000; // 3s → 6s → 12s → 24s → 48s → 60s

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
        return { text };
      } catch (error: any) {
        const statusCode = error.status || error.httpStatusCode || 0;
        const isRetryable = statusCode === 503 || statusCode === 429 || statusCode >= 500;

        logger.error(`Gemini API call failed (attempt ${attempt}/${MAX_API_RETRIES})`, {
          error: error.message,
          status: statusCode,
          retryable: isRetryable,
        });

        // Non-retryable errors (400 Bad Request, 401 Unauthorized, 403 Forbidden)
        // fail immediately — no point retrying with the same payload.
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
