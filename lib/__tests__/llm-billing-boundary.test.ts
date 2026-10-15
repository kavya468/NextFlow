import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  tasks: new Map<string, { retry: { maxAttempts: number }; run: (payload: Record<string, unknown>) => Promise<unknown> }>(),
  getModel: vi.fn(), generate: vi.fn(), fetch: vi.fn(), imageFetch: vi.fn(), log: vi.fn(),
}));
vi.mock("@trigger.dev/sdk/v3", () => ({
  task: (config: { id: string; retry: { maxAttempts: number }; run: (payload: Record<string, unknown>) => Promise<unknown> }) => { mocks.tasks.set(config.id, config); return config; },
  logger: { info: mocks.log, warn: mocks.log, error: mocks.log },
}));
vi.mock("@trigger.dev/sdk", () => ({
  task: (config: { id: string; retry: { maxAttempts: number }; run: (payload: Record<string, unknown>) => Promise<unknown> }) => { mocks.tasks.set(config.id, config); return config; },
  logger: { info: mocks.log, warn: mocks.log, error: mocks.log },
}));
vi.mock("@google/generative-ai", () => ({ GoogleGenerativeAI: class { getGenerativeModel = mocks.getModel; } }));
vi.mock("@/lib/safe-fetch", () => ({ publicFetch: mocks.imageFetch }));

import "../../src/trigger/llm";
import "../../src/trigger/openrouter.task";

function run(id: string, input: Record<string, unknown>) {
  const task = mocks.tasks.get(id);
  if (!task) throw new Error(`Missing test task: ${id}`);
  return task.run(input);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.getModel.mockReturnValue({ generateContent: mocks.generate });
  mocks.generate.mockResolvedValue({ response: { text: () => "answer", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 35 } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("LLM billing limits at provider boundaries", () => {
  it.each(["non-OK response", "download error"])("stops before generation when a requested vision image fails: %s", async (failure) => {
    const imageUrl = "https://media.example.test/image.png?signature=private-test-signature";
    if (failure === "download error") mocks.imageFetch.mockRejectedValue(new Error(`Failed to download ${imageUrl}`));
    else mocks.imageFetch.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(run("generate-llm-content", { userMessage: "private test prompt", images: [imageUrl] })).rejects.toThrow("Failed to load vision image 1");
    expect(mocks.imageFetch).toHaveBeenCalledTimes(1);
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain(imageUrl);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("private test prompt");
  });

  it("caps explicit Gemini 429 responses at three calls with no task replay", async () => {
    vi.useFakeTimers();
    const failure = Object.assign(new Error("Rate limited"), { status: 429 });
    mocks.generate.mockRejectedValue(failure);
    const result = expect(run("generate-llm-content", { userMessage: "hello" })).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.generate).toHaveBeenCalledTimes(3);
    expect(mocks.tasks.get("generate-llm-content")!.retry.maxAttempts).toBe(1);
  });

  it.each([
    new TypeError("fetch failed"),
    new Error("connection timed out"),
    ...[400, 500, 503, 504].map(status => Object.assign(new Error(`Provider response ${status}`), { status })),
  ])("does not repeat transport, 5xx, or permanent provider failures: %s", async (failure) => {
    mocks.generate.mockRejectedValue(failure);
    await expect(run("generate-llm-content", { userMessage: "hello" })).rejects.toBe(failure);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
  });

  it("returns the successful result after a rate-limit rejection", async () => {
    vi.useFakeTimers();
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { httpStatusCode: 429 }));
    const result = expect(run("generate-llm-content", { userMessage: "hello" })).resolves.toMatchObject({ text: "answer" });
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it("stops retrying when a rate-limit rejection is followed by an ambiguous 503", async () => {
    vi.useFakeTimers();
    const failure = Object.assign(new Error("Provider response 503"), { status: 503 });
    mocks.generate.mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 })).mockRejectedValue(failure);
    const result = expect(run("generate-llm-content", { userMessage: "hello" })).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    await result;
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });

  it("forwards the Gemini output limit and includes reasoning usage in the returned billable count", async () => {
    await expect(run("generate-llm-content", { userMessage: "hello", max_tokens: 1234 })).resolves.toMatchObject({ usage: { prompt_tokens: 10, completion_tokens: 25 } });
    expect(mocks.getModel).toHaveBeenCalledWith(expect.objectContaining({ generationConfig: expect.objectContaining({ maxOutputTokens: 1234 }) }));
  });

  it.each(["generate-llm-content", "openrouter-generate"])("rejects an unpriced model or excess token limit before %s can call a provider", async (id) => {
    const base = id === "generate-llm-content" ? { userMessage: "hello" } : { user_message: "hello" };
    await expect(run(id, { ...base, max_tokens: 8193 })).rejects.toThrow();
    await expect(run(id, { ...base, model: "unpriced-model" })).rejects.toThrow();
    expect(mocks.getModel).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.imageFetch).not.toHaveBeenCalled();
  });

  it.each(["anthropic/claude-sonnet-4.5", "anthropic/claude-sonnet-4-5"])("forwards the validated OpenRouter output limit and canonical model from %s", async (model) => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-only");
    mocks.fetch.mockResolvedValue(Response.json({ choices: [{ message: { content: "answer" } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    await run("openrouter-generate", { user_message: "hello", max_tokens: 8192, model });
    const options = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body)).max_tokens).toBe(8192);
    expect(JSON.parse(String(options.body)).model).toBe("anthropic/claude-sonnet-4.5");
  });
});
