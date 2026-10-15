import { ValidationError } from "../services/errors";

/** Snapshot accounting corruption is fatal; ordinary unsupported inputs are node failures. */
export class ExecutionReservationError extends ValidationError {
  constructor(details: string) {
    super(details);
    this.name = "ExecutionReservationError";
  }
}

/** Versioned application limits, not a live provider pricing feed. See docs/BILLING_POLICY.md. */
export const BILLING_LIMITS = {
  userMessageCharacters: 32_768,
  systemPromptCharacters: 8_192,
  promptCharacters: 32_768,
  visionImages: 4,
  outputTokens: 8_192,
  providerContextTokens: 1_048_576,
  dialogueBytes: 20_000,
  dialogueLines: 100,
  imageGenerations: 6,
  imagesPerGeneration: 6,
  videoSeconds: 12,
  videoFramesPerSecond: 24,
  // Covers all supported aspect ratios up to 1080p, with padding headroom.
  videoWidth: 2_560,
  videoHeight: 1_440,
} as const;

export const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-pro"] as const;
export const OPENROUTER_MODELS = [
  "google/gemini-2.5-flash",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-sonnet-4-5",
  "meta-llama/llama-3-8b-instruct",
] as const;

export const OPENROUTER_MODEL_ALIASES = { "anthropic/claude-sonnet-4-5": "anthropic/claude-sonnet-4.5" } as const;

export function canonicalOpenRouterModel(model: string): string {
  return model === "anthropic/claude-sonnet-4-5" ? OPENROUTER_MODEL_ALIASES[model] : model;
}

export const BILLING_RATES = {
  image: 40_000,
  dialogueCharacter: 100,
  videoTokenWithAudio: 2.4,
  videoTokenWithoutAudio: 1.2,
} as const;

const RESERVATIONS: Record<string, number> = {
  // Existing NextFlow credit tariffs: Gemini 1/3, OpenRouter worst case 3/15.
  // Full context includes system text and vision, even when connected upstream.
  llm: BILLING_LIMITS.providerContextTokens + BILLING_LIMITS.outputTokens * 3,
  "openrouter-llm": BILLING_LIMITS.providerContextTokens * 3 + BILLING_LIMITS.outputTokens * 15,
  "elevenlabs-tts": BILLING_LIMITS.dialogueBytes * BILLING_RATES.dialogueCharacter,
  "seedream-4.5": BILLING_LIMITS.imageGenerations * BILLING_LIMITS.imagesPerGeneration * BILLING_RATES.image,
  "seedance-1.5": Math.ceil(BILLING_LIMITS.videoWidth * BILLING_LIMITS.videoHeight * BILLING_LIMITS.videoFramesPerSecond * BILLING_LIMITS.videoSeconds / 1024 * BILLING_RATES.videoTokenWithAudio),
};

/** Independent of untrusted static values: model, quantities and text can all be wired. */
export function estimateNodeReservation(nodeType: string): number {
  const amount = RESERVATIONS[nodeType];
  if (!Object.hasOwn(RESERVATIONS, nodeType)) throw new ValidationError(`No bounded reservation is configured for ${nodeType}`);
  return amount;
}

function boundedText(value: unknown, label: string, maximum: number, required = false) {
  if (value === undefined && !required) return;
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) {
    throw new ValidationError(`${label} must be ${required ? "non-empty text" : "text"} of at most ${maximum} characters`);
  }
}

function allowed(value: unknown, fallback: string, options: readonly string[], label: string) {
  const effective = value ?? fallback;
  if (typeof effective !== "string" || !options.includes(effective)) {
    throw new ValidationError(`${label} is not supported by the current billing policy`);
  }
  return effective;
}

function boundedInteger(value: unknown, fallback: number, maximum: number, label: string) {
  const effective = value ?? fallback;
  if (typeof effective !== "number" || !Number.isInteger(effective) || effective < 1 || effective > maximum) {
    throw new ValidationError(`${label} must be an integer between 1 and ${maximum}`);
  }
  return effective;
}

/** Also used at the LLM task boundary, before an API request is possible. */
export function validateLlmBillingInputs(nodeType: "llm" | "openrouter-llm", inputs: Record<string, unknown>): void {
  allowed(inputs.model, nodeType === "llm" ? GEMINI_MODELS[0] : OPENROUTER_MODELS[0], nodeType === "llm" ? GEMINI_MODELS : OPENROUTER_MODELS, "Model");
  boundedText(inputs.user_message, "User message", BILLING_LIMITS.userMessageCharacters, true);
  boundedText(inputs.system_prompt, "System prompt", BILLING_LIMITS.systemPromptCharacters);
  boundedInteger(inputs.max_tokens, nodeType === "llm" ? 2048 : 512, BILLING_LIMITS.outputTokens, "Output token limit");
  if (inputs.images !== undefined && (!Array.isArray(inputs.images) || inputs.images.length > BILLING_LIMITS.visionImages || inputs.images.some((image) => typeof image !== "string" || !image.trim()))) {
    throw new ValidationError(`Vision input must contain at most ${BILLING_LIMITS.visionImages} image URLs`);
  }
}

export function validateDialogueBillingInputs(inputs: Record<string, unknown>): void {
  const dialogue = inputs.inputs;
  if (typeof dialogue !== "string" && !Array.isArray(dialogue)) {
    throw new ValidationError("Dialogue must be text or an array of speaker lines");
  }
  if (typeof dialogue === "string" && !dialogue.trim()) throw new ValidationError("Dialogue cannot be empty");
  if (Array.isArray(dialogue) && (dialogue.length === 0 || dialogue.length > BILLING_LIMITS.dialogueLines || dialogue.some((line) => !line || typeof line !== "object" || typeof line.text !== "string" || typeof line.voice !== "string"))) {
    throw new ValidationError(`Dialogue must contain 1–${BILLING_LIMITS.dialogueLines} lines with text and voice`);
  }
  const merged = Array.isArray(dialogue) ? dialogue.map((line, index) => {
    const connected = inputs[`dialogue_text_${index}`];
    return { ...line, text: typeof connected === "string" && connected !== "" ? connected : line.text };
  }) : undefined;
  if (merged?.some(line => !line.text.trim())) throw new ValidationError("Dialogue text cannot be empty after connected lines are applied");
  const serialized = typeof dialogue === "string" ? dialogue : JSON.stringify(merged);
  let bytes = new TextEncoder().encode(serialized).byteLength;
  // Runtime tasks may merge these handles after the ordinary input schema.
  for (const [key, value] of Object.entries(inputs)) {
    if (!/^dialogue_text_\d+$/.test(key) || value == null || value === "") continue;
    if (typeof value !== "string") throw new ValidationError("Connected dialogue lines must be text");
    // Structured lines were counted after composition above. For smart-parsed
    // strings, over-counting the override is safe until the task parses them.
    if (typeof dialogue === "string") bytes += new TextEncoder().encode(value).byteLength;
  }
  if (bytes > BILLING_LIMITS.dialogueBytes) {
    throw new ValidationError(`Dialogue including connected lines must fit within ${BILLING_LIMITS.dialogueBytes} UTF-8 bytes`);
  }
}

export function assertNodeBillingAvailable(nodeType: string): void {
  if (nodeType === "sync-lipsync" || nodeType === "kling-01") {
    throw new ValidationError(`${nodeType === "sync-lipsync" ? "Lipsync" : "Kling video editing"} is temporarily unavailable: verified media duration and usage billing are required before paid execution. Use bounded Seedance generation or the free local media nodes meanwhile.`);
  }
}

/** Validate the fully composed inputs against the immutable preflight hold. */
export function validateExecutionBudget(nodeType: string, inputs: Record<string, unknown>, snapshotEstimate: number): void {
  assertNodeBillingAvailable(nodeType);
  if (!Object.hasOwn(RESERVATIONS, nodeType)) return;
  const required = estimateNodeReservation(nodeType);
  if (!Number.isSafeInteger(snapshotEstimate) || snapshotEstimate < required) {
    throw new ExecutionReservationError(`The reservation for ${nodeType} is too low for the supported input limits. Prepare a new execution before running this node.`);
  }
  if (nodeType === "llm" || nodeType === "openrouter-llm") {
    validateLlmBillingInputs(nodeType, inputs);
  } else if (nodeType === "elevenlabs-tts") {
    validateDialogueBillingInputs(inputs);
  } else if (nodeType === "seedream-4.5") {
    allowed(inputs.mode, "generate", ["generate", "edit"], "Seedream mode");
    boundedText(inputs.prompt, "Prompt", BILLING_LIMITS.promptCharacters, true);
    boundedInteger(inputs.num_images, 1, BILLING_LIMITS.imageGenerations, "Image generations");
    boundedInteger(inputs.max_images, 1, BILLING_LIMITS.imagesPerGeneration, "Images per generation");
  } else if (nodeType === "seedance-1.5") {
    boundedText(inputs.prompt, "Prompt", BILLING_LIMITS.promptCharacters, true);
    allowed(inputs.mode, "text-to-video", ["text-to-video", "image-to-video"], "Seedance mode");
    allowed(inputs.resolution, "720p", ["480p", "720p", "1080p"], "Video resolution");
    allowed(inputs.aspect_ratio, "16:9", ["16:9", "21:9", "4:3", "1:1", "3:4", "9:16"], "Video aspect ratio (auto requires verified media dimensions)");
    allowed(inputs.duration, "5", Array.from({ length: BILLING_LIMITS.videoSeconds - 3 }, (_, i) => String(i + 4)), "Video duration");
    if (inputs.generate_audio !== undefined && typeof inputs.generate_audio !== "boolean") throw new ValidationError("Generate audio must be a boolean");
  }
}

/** Published Seedance video-token tariff; dimensions are derived from the selected preset. */
export function calculateSeedanceCredits(inputs: Record<string, unknown>): number {
  validateExecutionBudget("seedance-1.5", inputs, estimateNodeReservation("seedance-1.5"));
  const shortEdge = Number(String(inputs.resolution ?? "720p").replace("p", ""));
  const [a, b] = String(inputs.aspect_ratio ?? "16:9").split(":").map(Number);
  const pixels = shortEdge * shortEdge * Math.max(a, b) / Math.min(a, b);
  const rate = inputs.generate_audio === false ? BILLING_RATES.videoTokenWithoutAudio : BILLING_RATES.videoTokenWithAudio;
  return Math.ceil(pixels * BILLING_LIMITS.videoFramesPerSecond * Number(inputs.duration ?? "5") / 1024 * rate);
}
