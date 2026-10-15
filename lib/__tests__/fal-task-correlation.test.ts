import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodeRegistry } from "@/lib/nodes/registry";
import { elevenlabsConfig } from "@/lib/nodes/configs/elevenlabs.config";

const mocks = vi.hoisted(() => ({
  tasks: new Map<string, { retry: { maxAttempts: number }; run: (payload: unknown) => Promise<unknown> }>(),
  createToken: vi.fn(),
  forToken: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@trigger.dev/sdk/v3", () => ({
  task: (config: { id: string; retry: { maxAttempts: number }; run: (payload: unknown) => Promise<unknown> }) => {
    mocks.tasks.set(config.id, config);
    return config;
  },
  wait: { createToken: mocks.createToken, forToken: mocks.forToken },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@trigger.dev/sdk", () => ({
  task: (config: { id: string; retry: { maxAttempts: number }; run: (payload: unknown) => Promise<unknown> }) => {
    mocks.tasks.set(config.id, config);
    return config;
  },
  wait: { createToken: mocks.createToken, forToken: mocks.forToken },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import "../../src/trigger/seedream";
import "../../src/trigger/seedance.task";
import "../../src/trigger/kling.task";
import "../../src/trigger/sync-lipsync.task";
import "../../src/trigger/elevenlabs.task";

const video = "https://media.example.test/video.mp4";
const audio = "https://media.example.test/audio.mp3";
const image = "https://media.example.test/image.png";
const requestId = "queued-request-1";

const consumers = [
  { id: "seedream-4.5", input: { prompt: "A mountain" }, payload: { images: [{ url: image }] }, output: { image_url: image, image_urls: [image], generatedImageCount: 1 } },
  { id: "seedance-generate", input: { prompt: "A mountain" }, payload: { video: { url: video }, seed: 42 }, output: { video_url: video, seed: "42" } },
  { id: "kling-generate", input: { mode: "edit", prompt: "A mountain", video_url: video }, payload: { video: { url: video } }, output: { video_url: video } },
  { id: "sync-lipsync-generate", input: { video_url: video, audio_url: audio }, payload: { video: { url: video } }, output: { video_url: video } },
  { id: "elevenlabs-generate", input: { inputs: [{ text: "Hello", voice: "default" }] }, payload: { audio: { url: audio }, seed: 42 }, output: { audio_url: audio, seed: 42, billableCharacters: 5 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FAL_KEY", "test-only-provider-key");
  vi.stubEnv("FAL_WEBHOOK_SECRET", "test-only-webhook-secret");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test");
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.createToken.mockResolvedValue({ id: "test-wait-token", isCached: false });
  mocks.fetch.mockResolvedValue(Response.json({ request_id: requestId, status: "IN_QUEUE" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(consumers)("$id callback correlation", ({ id, input, payload, output }) => {
  const run = () => {
    const task = mocks.tasks.get(id);
    if (!task) throw new Error(`Task ${id} was not registered`);
    return task.run(input);
  };

  it("returns the normal provider output for the queued request", async () => {
    mocks.forToken.mockResolvedValue({ ok: true, output: { request_id: requestId, status: "OK", payload } });
    await expect(run()).resolves.toEqual(output);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.forToken).toHaveBeenCalledExactlyOnceWith({ id: "test-wait-token", isCached: false });
  });

  it("preserves a matching provider failure", async () => {
    mocks.forToken.mockResolvedValue({ ok: true, output: { request_id: requestId, status: "ERROR", error: "Provider rejected this test input" } });
    await expect(run()).rejects.toThrow("Provider rejected this test input");
  });

  it.each(["OK", "ERROR"])("rejects a valid %s payload for a different queued request", async (status) => {
    mocks.forToken.mockResolvedValue({ ok: true, output: {
      request_id: "another-request", status, payload, error: "Unrelated provider error",
    } });
    await expect(run()).rejects.toThrow("Provider callback does not match the queued request");
  });

  it("rejects a callback without a request ID", async () => {
    mocks.forToken.mockResolvedValue({ ok: true, output: { status: "OK", payload } });
    await expect(run()).rejects.toThrow("Provider callback does not match the queued request");
  });

  it.each([{ request_id: "" }, {}])("never waits when the queue returns no usable ID: %j", async (queueResponse) => {
    mocks.fetch.mockResolvedValue(Response.json(queueResponse));
    await expect(run()).rejects.toThrow("Provider queue response has no valid request ID");
    expect(mocks.forToken).not.toHaveBeenCalled();
  });

  it("preserves the provider timeout failure", async () => {
    mocks.forToken.mockResolvedValue({ ok: false, error: { message: "Timed out" } });
    await expect(run()).rejects.toThrow("Provider timeout");
  });

  it("does not repeat an ambiguous queue POST or enable task replay", async () => {
    mocks.fetch.mockRejectedValue(new TypeError("connection dropped after request write"));
    await expect(run()).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.forToken).not.toHaveBeenCalled();
    expect(mocks.tasks.get(id)!.retry.maxAttempts).toBe(1);
  });
});

it("preserves every generated Seedream image for downstream array inputs", async () => {
  const images = [image, "https://media.example.test/second.png"];
  mocks.forToken.mockResolvedValue({ ok: true, output: { request_id: requestId, status: "OK", payload: { images: images.map(url => ({ url })) } } });
  const output = await mocks.tasks.get("seedream-4.5")!.run({ prompt: "A mountain", num_images: 2 });
  expect(output).toEqual({ image_url: image, image_urls: images, generatedImageCount: 2 });
});

describe("ElevenLabs connected dialogue billing", () => {
  it("preserves unmatched dialogue lines and leaves caller inputs immutable", async () => {
    mocks.forToken.mockResolvedValue({ ok: true, output: { request_id: requestId, status: "OK", payload: { audio: { url: audio }, seed: 42 } } });
    await mocks.tasks.get("elevenlabs-generate")!.run({ inputs: "Rachel: Hello\nThis line has no speaker" });
    const firstRequest = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(firstRequest.body)).inputs).toEqual([{ text: "Rachel: Hello", voice: "default" }, { text: "This line has no speaker", voice: "default" }]);
    mocks.fetch.mockResolvedValue(Response.json({ request_id: requestId, status: "IN_QUEUE" }));
    const inputs = [{ text: "Draft", voice: "Rachel" }];
    await mocks.tasks.get("elevenlabs-generate")!.run({ inputs, dialogue_text_0: "Final" });
    expect(inputs).toEqual([{ text: "Draft", voice: "Rachel" }]);
  });

  it("maps only dialogue handles, sends the connected text, and charges that same final text", async () => {
    nodeRegistry.register(elevenlabsConfig);
    const resolved = nodeRegistry.resolveEndpoint("elevenlabs-tts", {
      inputs: [{ text: "", voice: "default" }],
      dialogue_text_0: "Hello\u{1F31E}", dialogue_text_bad: "not a handle", unrelated: "must not reach the task",
    });
    expect(resolved?.payload).toEqual({ inputs: [{ text: "", voice: "default" }], dialogue_text_0: "Hello\u{1F31E}" });
    mocks.forToken.mockResolvedValue({ ok: true, output: { request_id: requestId, status: "OK", payload: { audio: { url: audio }, seed: 42 } } });
    const task = mocks.tasks.get("elevenlabs-generate");
    if (!task || !resolved) throw new Error("Missing test task mapping");
    const output = await task.run(resolved.payload);
    const options = mocks.fetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(options.body)).inputs).toEqual([{ text: "Hello\u{1F31E}", voice: "default" }]);
    expect(output).toMatchObject({ billableCharacters: 6 });
    expect(elevenlabsConfig.credits.calculate({}, output)).toBe(600);
  });

  it("rejects oversized connected dialogue before creating a waitpoint or sending a provider request", async () => {
    const task = mocks.tasks.get("elevenlabs-generate");
    if (!task) throw new Error("Missing test task");
    await expect(task.run({ inputs: [{ text: "draft", voice: "default" }], dialogue_text_0: "a".repeat(20_001) })).rejects.toThrow("UTF-8 bytes");
    expect(mocks.createToken).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
