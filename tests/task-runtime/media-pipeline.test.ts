import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nodeRegistry } from "@/lib/nodes/registry";
import { resolveNodeInputs, mapAndValidateNodeOutput } from "@/lib/services/node-inputs";
import "@/lib/nodes/configs";

const mocks = vi.hoisted(() => ({
  tasks: new Map<string, { retry: { maxAttempts: number }; run: (input: unknown) => Promise<unknown> }>(),
  download: vi.fn(), upload: vi.fn(),
}));
const sdkMock = () => ({
  task: (config: { id: string; retry: { maxAttempts: number }; run: (input: unknown) => Promise<unknown> }) => {
    mocks.tasks.set(config.id, config);
    return config;
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
});
vi.mock("@trigger.dev/sdk", () => sdkMock());
vi.mock("@trigger.dev/sdk/v3", () => sdkMock());
vi.mock("@/lib/safe-fetch", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/safe-fetch")>(), publicFetch: mocks.download,
}));

const execute = promisify(execFile);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const nativeAvailable = spawnSync(ffmpeg, ["-version"]).status === 0 && spawnSync(ffprobe, ["-version"]).status === 0;
// These tests deliberately use native binaries; they never contact hosted services.
let fixtures: string;
const assets = new Map<string, Buffer>();
const assemblies = new Map<string, string>();
let nextUpload = 0;
const sourceUrl = "https://fixtures.example/source.mp4";
const silentUrl = "https://fixtures.example/silent.mp4";

async function runNode(type: string, input: Record<string, unknown>) {
  const parsed = resolveNodeInputs({ id: type, type, data: input, position: { x: 0, y: 0 } }, [], new Map());
  const endpoint = nodeRegistry.resolveEndpoint(type, parsed)!;
  const task = mocks.tasks.get(endpoint.taskId);
  if (!task) throw new Error(`Task not registered: ${endpoint.taskId}`);
  const output = await task.run(endpoint.payload);
  return mapAndValidateNodeOutput(type, endpoint.endpointId, output);
}

async function materialize(url: unknown) {
  expect(typeof url).toBe("string");
  const buffer = assets.get(String(url));
  if (!buffer) throw new Error(`Missing mocked upload: ${url}`);
  const file = path.join(fixtures, `probe-${assets.size}-${assemblies.size}-${Math.random()}`);
  await writeFile(file, buffer);
  return file;
}

async function probe(url: unknown) {
  const { stdout } = await execute(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", await materialize(url)]);
  return JSON.parse(stdout) as { streams: Array<{ codec_type: string; width?: number; height?: number }>; format: { duration: string } };
}

async function firstPixel(url: unknown) {
  const { stdout } = await execute(ffmpeg, ["-v", "error", "-i", await materialize(url), "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], { encoding: "buffer" });
  return [...stdout];
}

beforeAll(async () => {
  await execute(ffmpeg, ["-version"]);
  await execute(ffprobe, ["-version"]);
  fixtures = await mkdtemp(path.join(os.tmpdir(), "nextflow-media-pipeline-"));
  vi.stubEnv("NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY", "test-only");
  vi.stubEnv("TRANSLOADIT_AUTH_SECRET", "test-only");
  const source = path.join(fixtures, "source.mp4");
  await execute(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=red:size=160x120:rate=24:duration=1", "-f", "lavfi", "-i", "color=c=blue:size=160x120:rate=24:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source]);
  const silent = path.join(fixtures, "silent.mp4");
  await execute(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=green:size=128x96:rate=12:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent]);
  assets.set(sourceUrl, await readFile(source));
  assets.set(silentUrl, await readFile(silent));
  await import("@/src/trigger/media");
  await import("@/src/trigger/ffmpeg-extract.task");
  await import("@/src/trigger/ffmpeg-merge.task");
  await import("@/src/trigger/ffmpeg-merge-videos.task");
}, 30_000);

beforeEach(() => {
  mocks.download.mockReset();
  mocks.upload.mockReset();
  vi.stubGlobal("fetch", mocks.upload);
  mocks.upload.mockImplementation(async (url: string, options: RequestInit) => {
    if (url !== "https://api2.transloadit.com/assemblies" || options.method !== "POST") throw new Error(`Unexpected upload: ${url}`);
    const file = (options.body as FormData).get("file") as File;
    const id = ++nextUpload;
    const assetUrl = `https://fixtures.example/upload-${id}/${file.name}`;
    assets.set(assetUrl, Buffer.from(await file.arrayBuffer()));
    const assemblyUrl = `https://api2.transloadit.com/assemblies/test-${id}`;
    assemblies.set(assemblyUrl, assetUrl);
    return Response.json({ assembly_ssl_url: assemblyUrl });
  });
  mocks.download.mockImplementation(async (url: string) => {
    const uploaded = assemblies.get(url);
    if (uploaded) return Response.json({ ok: "ASSEMBLY_COMPLETED", results: { ":original": [{ ssl_url: uploaded }], resize: [{ ssl_url: uploaded }] }, uploads: [{ ssl_url: uploaded }] });
    const asset = assets.get(url);
    if (!asset) throw new Error(`Unexpected download: ${url}`);
    return new Response(new Uint8Array(asset));
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (fixtures) await rm(fixtures, { recursive: true, force: true });
});

describe.skipIf(!nativeAvailable)("real FFmpeg node payload pipeline with isolated uploads", () => {
  it("extracts the first frame for 0% and passes its output through a percentage crop", async () => {
    const frame = await runNode("extract", { video_url: sourceUrl, timestamp: "0%" });
    const [red, , blue] = await firstPixel(frame.url);
    expect(red).toBeGreaterThan(200);
    expect(blue).toBeLessThan(40);
    const crop = await runNode("crop", { image_url: frame.url, x_percent: 25, y_percent: 25, width_percent: 50, height_percent: 50 });
    expect((await probe(crop.url)).streams[0]).toMatchObject({ width: 80, height: 60 });
    expect(mocks.upload).toHaveBeenCalledTimes(2);
  });

  it("extracts the last available frame for 100%", async () => {
    const frame = await runNode("extract", { video_url: sourceUrl, timestamp: "100%" });
    const [red, , blue] = await firstPixel(frame.url);
    expect(red).toBeLessThan(40);
    expect(blue).toBeGreaterThan(200);
  });

  it("extracts audio, wires it into video replacement, then concatenates a silent differently sized clip", async () => {
    const audio = await runNode("extract-audio", { video_url: sourceUrl });
    const audioProbe = await probe(audio.audio_url);
    expect(audioProbe.streams.map(stream => stream.codec_type)).toEqual(["audio"]);
    const merged = await runNode("merge-audio-video", { video_url: sourceUrl, audio_url: audio.audio_url });
    expect((await probe(merged.video_url)).streams.map(stream => stream.codec_type)).toEqual(["video", "audio"]);
    const concatenated = await runNode("merge-videos", { video_urls: [merged.video_url, silentUrl] });
    const info = await probe(concatenated.merged_video_url);
    expect(info.streams[0]).toMatchObject({ codec_type: "video", width: 160, height: 120 });
    expect(info.streams[1].codec_type).toBe("audio");
    expect(Number(info.format.duration)).toBeGreaterThan(2.9);
    expect(Number(info.format.duration)).toBeLessThan(3.3);
    expect(mocks.upload).toHaveBeenCalledTimes(3);
  }, 30_000);

  it("rejects missing source audio before creating an upload", async () => {
    await expect(runNode("extract-audio", { video_url: silentUrl })).rejects.toThrow(/audio/i);
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("keeps concurrent frame extractions isolated when both start in the same millisecond", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    try {
      const [redFrame, greenFrame] = await Promise.all([
        runNode("extract", { video_url: sourceUrl, timestamp: "0%" }),
        runNode("extract", { video_url: silentUrl, timestamp: "0%" }),
      ]);
      expect((await probe(redFrame.url)).streams[0]).toMatchObject({ width: 160, height: 120 });
      expect((await probe(greenFrame.url)).streams[0]).toMatchObject({ width: 128, height: 96 });
    } finally {
      now.mockRestore();
    }
  });

  it("does not repeat an upload with an ambiguous transport result", async () => {
    mocks.upload.mockRejectedValue(new TypeError("connection dropped after upload write"));
    await expect(runNode("extract", { video_url: sourceUrl, timestamp: "0%" })).rejects.toThrow("connection dropped");
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(mocks.tasks.get("extract-frame")!.retry.maxAttempts).toBe(1);
    expect(mocks.tasks.get("crop-image")!.retry.maxAttempts).toBe(1);
  });
});
