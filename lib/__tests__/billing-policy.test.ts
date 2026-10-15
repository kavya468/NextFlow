import { describe, expect, it } from "vitest";
import {
  BILLING_LIMITS, ExecutionReservationError, calculateSeedanceCredits, estimateNodeReservation,
  validateDialogueBillingInputs, validateExecutionBudget,
} from "@/lib/credits/billing-policy";
import { nodeRegistry } from "@/lib/nodes/registry";
import { prepareExecutionGraph } from "@/lib/services/execution-graph";
import {
  llmConfig, openrouterConfig, elevenlabsConfig, seedreamConfig, seedanceConfig,
  textConfig, imageConfig, videoConfig, cropConfig, extractConfig,
  extractAudioConfig, mergeAudioVideoConfig, mergeVideosConfig,
} from "@/lib/nodes/configs";

describe("bounded paid-node reservations", () => {
  it.each([llmConfig, openrouterConfig, elevenlabsConfig, seedreamConfig, seedanceConfig])("reserves a positive fixed maximum for $id, including empty or manipulated static data", (config) => {
    const amount = config.credits.estimate({});
    expect(amount).toBeGreaterThan(0);
    expect(Number.isSafeInteger(amount)).toBe(true);
    expect(config.credits.estimate({ user_message: "", inputs: "", max_tokens: 1, num_images: 0, model: "free", cost: 0 })).toBe(amount);
  });

  it("covers the formerly free wired OpenRouter graph and rejects an old zero reservation before admission", () => {
    const graph = prepareExecutionGraph([
      { id: "text", type: "text", position: { x: 0, y: 0 }, data: { label: "Brief", text: "Write a long story" } },
      { id: "model", type: "openrouter-llm", position: { x: 0, y: 0 }, data: { user_message: "", model: "anthropic/claude-sonnet-4-5", max_tokens: 8192 } },
    ], [{ id: "edge", source: "text", target: "model", sourceHandle: "text", targetHandle: "user_message" }]);
    const model = graph.nodes.find(node => node.id === "model")!;
    const reservation = openrouterConfig.credits.estimate(model.data);
    const composed = nodeRegistry.getInputSchema(model.type).parse({ ...model.data, user_message: "Write a long story" });
    expect(reservation).toBeGreaterThanOrEqual(openrouterConfig.credits.calculate(composed, { usage: { prompt_tokens: 1_048_576, completion_tokens: 8192 } }));
    expect(() => validateExecutionBudget(model.type, composed, reservation)).not.toThrow();
    expect(() => validateExecutionBudget(model.type, composed, 0)).toThrow(ExecutionReservationError);
    expect(model.data.model).toBe("anthropic/claude-sonnet-4-5");
    expect(composed.model).toBe("anthropic/claude-sonnet-4.5");
  });

  it.each([llmConfig, openrouterConfig])("bounds model, output, system text and image count for $id after composition", (config) => {
    const valid = { user_message: "hello", max_tokens: 8192 };
    const hold = config.credits.estimate({});
    for (const override of [
      { model: "unpriced-new-model" }, { max_tokens: 8193 }, { max_tokens: 1.5 },
      { system_prompt: "s".repeat(BILLING_LIMITS.systemPromptCharacters + 1) },
      { user_message: "x".repeat(BILLING_LIMITS.userMessageCharacters + 1) },
      { images: Array(5).fill("https://example.test/image.png") },
    ]) expect(() => validateExecutionBudget(config.id, { ...valid, ...override }, hold)).toThrow();
  });

  it("bounds connected dialogue and UTF-8 bytes, rather than trusting the draft JSON length", () => {
    expect(() => validateDialogueBillingInputs({ inputs: "a".repeat(20_000) })).not.toThrow();
    expect(() => validateDialogueBillingInputs({ inputs: "é".repeat(10_001) })).toThrow("UTF-8 bytes");
    expect(() => validateDialogueBillingInputs({ inputs: [{ text: "draft", voice: "default" }], dialogue_text_0: "a".repeat(20_000) })).toThrow("UTF-8 bytes");
    expect(() => validateDialogueBillingInputs({ inputs: Array(101).fill({ text: "x", voice: "default" }) })).toThrow("100 lines");
    expect(() => validateDialogueBillingInputs({ inputs: [{ text: "", voice: "default" }] })).toThrow();
    expect(elevenlabsConfig.credits.calculate({}, { billableCharacters: 5 })).toBe(500);
  });

  it("bounds Seedream quantities even when numeric values came from an upstream node", () => {
    const hold = estimateNodeReservation("seedream-4.5");
    expect(() => validateExecutionBudget("seedream-4.5", { prompt: "cat", num_images: 6, max_images: 6 }, hold)).not.toThrow();
    for (const value of [0, 7, 1.5, Infinity]) {
      expect(() => validateExecutionBudget("seedream-4.5", { prompt: "cat", num_images: value }, hold)).toThrow();
      expect(() => validateExecutionBudget("seedream-4.5", { prompt: "cat", max_images: value }, hold)).toThrow();
    }
    expect(seedreamConfig.credits.calculate({}, { generatedImageCount: 36 })).toBeLessThanOrEqual(hold);
    expect(seedreamConfig.credits.calculate({}, { generatedImageCount: 2 })).toBe(80_000);
  });

  it("uses Seedance duration, dimensions and audio pricing within its maximum reservation", () => {
    expect(calculateSeedanceCredits({ prompt: "cat" })).toBe(259_200);
    expect(calculateSeedanceCredits({ prompt: "cat", generate_audio: false })).toBe(129_600);
    const maximum = calculateSeedanceCredits({ prompt: "cat", duration: "12", resolution: "1080p", aspect_ratio: "21:9" });
    expect(maximum).toBeGreaterThan(1_000_000);
    expect(maximum).toBeLessThanOrEqual(estimateNodeReservation("seedance-1.5"));
    for (const override of [{ duration: "13" }, { resolution: "4k" }, { aspect_ratio: "auto" }]) {
      expect(() => calculateSeedanceCredits({ prompt: "cat", ...override })).toThrow();
    }
  });

  it.each(["kling-01", "sync-lipsync"])("blocks %s until billable duration is verified", (nodeType) => {
    expect(() => validateExecutionBudget(nodeType, { duration: "5", video_url: "https://example.test/a.mp4" }, 10_000_000)).toThrow("verified media duration");
    expect(() => prepareExecutionGraph([{ id: "video", type: nodeType, position: { x: 0, y: 0 }, data: {} }], [])).toThrow("verified media duration");
  });

  it.each([textConfig, imageConfig, videoConfig, cropConfig, extractConfig, extractAudioConfig, mergeAudioVideoConfig, mergeVideosConfig])("keeps $id free", (config) => {
    expect(config.credits.estimate({})).toBe(0);
    expect(() => validateExecutionBudget(config.id, {}, 0)).not.toThrow();
  });
});
