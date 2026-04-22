import { logger, task } from "@trigger.dev/sdk/v3";
import { z } from "zod";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = "google/gemini-2.5-flash";

const openRouterInputSchema = z.object({
  model: z
    .enum([
      "google/gemini-2.5-flash",
      "anthropic/claude-sonnet-4-5",
      "meta-llama/llama-3-8b-instruct",
    ])
    .default(DEFAULT_MODEL),
  system_prompt: z.string().optional(),
  user_message: z.string().trim().min(1, "User Message is required"),
  images: z.array(z.string()).optional(),
  max_tokens: z.number().int().min(1).max(8192).default(1024),
  temperature: z.number().min(0).max(2).default(0.7),
});

const openRouterOutputSchema = z.object({
  text: z.string(),
  usage: z.object({
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }).optional(),
  model: z.string(),
  finish_reason: z.string().optional(),
});

function getOpenRouterErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const error = (body as Record<string, unknown>).error;
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }

  return null;
}

function extractOpenRouterText(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;

  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return null;

  const message = (firstChoice as Record<string, unknown>).message;
  if (message && typeof message === "object") {
    const msg = message as Record<string, unknown>;
    const content = msg.content;

    if (typeof content === "string" && content.trim() !== "") {
      return content;
    }

    if (Array.isArray(content)) {
      const text = content
        .flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const p = part as Record<string, unknown>;
          // Skip thinking/reasoning blocks, only take text blocks
          if (p.type === "thinking" || p.type === "reasoning") return [];
          const value = p.text;
          return typeof value === "string" && value.trim() !== "" ? [value] : [];
        })
        .join("\n")
        .trim();

      if (text !== "") {
        return text;
      }
    }

    // Thinking models (e.g. gemini-2.5-pro) may return content: null with
    // the answer only in the reasoning/thinking field.
    const reasoning = msg.reasoning ?? msg.reasoning_content;
    if (typeof reasoning === "string" && reasoning.trim() !== "") {
      return reasoning;
    }
  }

  // Some providers put text directly on the choice object
  const fallbackText = (firstChoice as Record<string, unknown>).text;
  if (typeof fallbackText === "string" && fallbackText.trim() !== "") {
    return fallbackText;
  }

  return null;
}

export const openrouterGenerateTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "openrouter-generate",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: unknown) => {
    const inputResult = openRouterInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      logger.error("OpenRouter input validation failed", { issues });
      throw new Error(`OpenRouter input validation failed: ${issues}`);
    }

    const input = inputResult.data;
    const apiKey = process.env.OPENROUTER_API_KEY;
    const sanitizedImages = (input.images ?? []).filter(
      (image): image is string => typeof image === "string" && image.trim() !== ""
    );

    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY environment variable is not set. " +
          "Add your OpenRouter API key to your Trigger.dev environment variables."
      );
    }

    const userContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: input.user_message,
      },
    ];

    for (const imageUrl of sanitizedImages) {
      userContent.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
    }

    const messages: Array<
      | { role: "system"; content: string }
      | {
          role: "user";
          content: Array<
            | { type: "text"; text: string }
            | { type: "image_url"; image_url: { url: string } }
          >;
        }
    > = [];
    if (input.system_prompt && input.system_prompt.trim() !== "") {
      messages.push({
        role: "system",
        content: input.system_prompt.trim(),
      });
    }
    messages.push({
      role: "user",
      content: userContent,
    });

    logger.info("Starting OpenRouter generation", {
      model: input.model,
      hasSystemPrompt: messages.length === 2,
      imageCount: sanitizedImages.length,
    });

    let response: Response;
    try {
      response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: input.model,
          messages,
          max_tokens: input.max_tokens,
          temperature: input.temperature,
        }),
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "TimeoutError") {
        throw new Error(
          `OpenRouter connection timeout: Request did not complete within ${
            OPENROUTER_TIMEOUT_MS / 1000
          }s`
        );
      }

      throw new Error(
        `OpenRouter network error: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    const rawBody = await response.text();
    let parsedBody: unknown = null;

    if (rawBody.trim() !== "") {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        if (!response.ok) {
          throw new Error(
            `OpenRouter returned ${response.status}: ${rawBody.slice(0, 200)}`
          );
        }

        throw new Error(
          "OpenRouter returned a non-JSON response despite a successful status code"
        );
      }
    }

    if (!response.ok) {
      const providerMessage =
        getOpenRouterErrorMessage(parsedBody) ?? rawBody.slice(0, 200) ?? "Unknown error";

      const statusLabels: Record<number, string> = {
        400: "Bad Request",
        401: "Unauthorized",
        402: "Insufficient Credits",
        403: "Forbidden",
        404: "Not Found",
        408: "Timeout",
        429: "Rate Limited",
        500: "Internal Server Error",
        502: "Bad Gateway",
        503: "Service Unavailable",
      };
      const label = statusLabels[response.status] ?? response.statusText;

      logger.error("OpenRouter API error", {
        status: response.status,
        label,
        body: providerMessage,
      });

      throw new Error(
        `OpenRouter API Error (${response.status} ${label}): ${providerMessage}`
      );
    }

    const text = extractOpenRouterText(parsedBody);
    if (!text) {
      // Log the finish_reason and message shape to aid debugging
      const firstChoice =
        parsedBody &&
        typeof parsedBody === "object" &&
        Array.isArray((parsedBody as Record<string, unknown>).choices)
          ? ((parsedBody as Record<string, unknown>).choices as unknown[])[0]
          : undefined;
      logger.error("OpenRouter returned an unexpected response shape", {
        finish_reason:
          firstChoice && typeof firstChoice === "object"
            ? (firstChoice as Record<string, unknown>).finish_reason
            : undefined,
        message_keys:
          firstChoice &&
          typeof firstChoice === "object" &&
          (firstChoice as Record<string, unknown>).message &&
          typeof (firstChoice as Record<string, unknown>).message === "object"
            ? Object.keys((firstChoice as Record<string, unknown>).message as object)
            : undefined,
        raw: rawBody.slice(0, 2000),
      });
      throw new Error(
        "Invalid provider response: OpenRouter returned 200 but no response text was found"
      );
    }

    const usageRaw =
      parsedBody &&
      typeof parsedBody === "object"
        ? (parsedBody as Record<string, unknown>).usage
        : undefined;

    const usage =
      usageRaw &&
      typeof usageRaw === "object" &&
      typeof (usageRaw as Record<string, unknown>).prompt_tokens === "number"
        ? {
            prompt_tokens: (usageRaw as Record<string, unknown>).prompt_tokens as number,
            completion_tokens: (usageRaw as Record<string, unknown>).completion_tokens as number,
            total_tokens: (usageRaw as Record<string, unknown>).total_tokens as number,
          }
        : undefined;

    const finishReason =
      parsedBody &&
      typeof parsedBody === "object" &&
      Array.isArray((parsedBody as Record<string, unknown>).choices) &&
      ((parsedBody as Record<string, unknown>).choices as unknown[])[0] &&
      typeof ((parsedBody as Record<string, unknown>).choices as unknown[])[0] === "object"
        ? (
            ((parsedBody as Record<string, unknown>).choices as unknown[])[0] as Record<string, unknown>
          ).finish_reason as string | undefined
        : undefined;

    const outputResult = openRouterOutputSchema.safeParse({
      text,
      usage,
      model: input.model,
      finish_reason: finishReason,
    });
    if (!outputResult.success) {
      throw new Error("Invalid provider response: OpenRouter text output failed validation");
    }

    logger.info("OpenRouter generation complete", {
      model: input.model,
      outputLength: outputResult.data.text.length,
      promptTokens: outputResult.data.usage?.prompt_tokens,
      completionTokens: outputResult.data.usage?.completion_tokens,
    });

    return outputResult.data;
  },
});
