import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_MEDIA_INPUT_OPTIONS } from "../safe-fetch";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
const available = spawnSync(ffmpeg, ["-version"]).status === 0 &&
  spawnSync(ffprobe, ["-version"]).status === 0;

describe.skipIf(!available)("downloaded media stays inside local media decoders", () => {
  let directory: string;
  beforeAll(() => { directory = mkdtempSync(join(tmpdir(), "nextflow-media-test-")); });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));

  it.each(["png", "apng", "jpg", "mp4", "wav", "mpeg", "m2v"])("still decodes and processes a valid %s file", (extension) => {
    const input = join(directory, `input.${extension}`);
    const audio = extension === "wav";
    const mpeg = extension === "mpeg" || extension === "m2v";
    const generated = spawnSync(ffmpeg, [
      "-v", "error", "-f", "lavfi", "-i", audio ? "sine=frequency=440:duration=0.1" : "color=c=blue:s=16x16:d=0.2",
      ...(mpeg ? ["-c:v", "mpeg2video", "-t", "0.2"] : audio ? [] : ["-frames:v", extension === "apng" ? "2" : "1"]), input,
    ], { encoding: "utf8" });
    expect(generated.status, generated.stderr).toBe(0);
    const probe = spawnSync(ffprobe, ["-v", "error", ...LOCAL_MEDIA_INPUT_OPTIONS, "-show_streams", input], { encoding: "utf8" });
    expect(probe.status, probe.stderr).toBe(0);
    const converted = spawnSync(ffmpeg, ["-v", "error", ...LOCAL_MEDIA_INPUT_OPTIONS, "-i", input, "-f", "null", "-"], { encoding: "utf8" });
    expect(converted.status, converted.stderr).toBe(0);
  });

  it.each([
    ["hls", "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10,\nhttp://127.0.0.1:9/private\n#EXT-X-ENDLIST\n"],
    ["concat", "ffconcat version 1.0\nfile '/etc/passwd'\n"],
  ])("rejects a %s manifest before nested URL or file access", (name, contents) => {
    const input = join(directory, name === "hls" ? "untrusted.m3u8" : "untrusted.ffconcat");
    writeFileSync(input, contents);
    for (const binary of [ffprobe, ffmpeg]) {
      const result = spawnSync(binary, ["-v", "error", ...LOCAL_MEDIA_INPUT_OPTIONS,
        ...(binary === ffprobe ? [input] : ["-i", input, "-f", "null", "-"]),
      ], { encoding: "utf8", timeout: 2_000 });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("not on whitelist");
      expect(result.stderr).not.toContain("Connection refused");
    }
  });
});
