import { logger, task } from "@trigger.dev/sdk/v3";
import crypto from "crypto";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { z } from "zod";

const DOWNLOAD_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 60_000;
const ASSEMBLY_TIMEOUT_MS = 120_000;
const ASSEMBLY_POLL_INTERVAL_MS = 2_000;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 720;
const DEFAULT_FPS = 24;

const taskInputSchema = z.object({
  video_urls: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim() !== ""
      );
    }

    if (typeof value === "string") {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry !== "");
    }

    return value;
  }, z.array(z.string().url()).min(2, "At least two video URLs are required")),
});

const taskOutputSchema = z.object({
  merged_video_url: z.string().url(),
});

type ProbeData = {
  streams?: Array<{
    codec_type?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    duration?: number | string;
  }>;
  format?: {
    duration?: number | string;
  };
};

type VideoInfo = {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
};

if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}

if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} environment variable is not set. Add it to the Trigger.dev environment before running this task.`
    );
  }
  return value;
}

function createTransloaditSignature(paramsString: string, secret: string): string {
  const signature = crypto
    .createHmac("sha384", secret)
    .update(paramsString)
    .digest("hex");

  return `sha384:${signature}`;
}

async function pollAssembly(assemblyUrl: string): Promise<unknown> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < ASSEMBLY_TIMEOUT_MS) {
    const response = await fetch(assemblyUrl, {
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Transloadit polling failed with status ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    if (data.ok === "ASSEMBLY_COMPLETED") {
      return data;
    }

    if (typeof data.error === "string" && data.error.length > 0) {
      throw new Error(`Transloadit error: ${data.error}`);
    }

    await new Promise((resolve) => setTimeout(resolve, ASSEMBLY_POLL_INTERVAL_MS));
  }

  throw new Error("Transloadit upload timed out");
}

async function uploadVideoToTransloadit(filePath: string, filename: string): Promise<string> {
  const authKey = getRequiredEnv("NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY");
  const authSecret = getRequiredEnv("TRANSLOADIT_AUTH_SECRET");

  const params = {
    auth: {
      key: authKey,
      expires:
        new Date(Date.now() + 30 * 60 * 1000)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19) + "+00:00",
    },
    steps: {
      ":original": {
        robot: "/upload/handle",
      },
    },
  };

  const paramsString = JSON.stringify(params);
  const signature = createTransloaditSignature(paramsString, authSecret);
  const fileBuffer = await fs.readFile(filePath);

  const formData = new FormData();
  formData.append("params", paramsString);
  formData.append("signature", signature);
  formData.append("file", new Blob([fileBuffer], { type: "video/mp4" }), filename);

  const response = await fetch("https://api2.transloadit.com/assemblies", {
    method: "POST",
    body: formData,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Transloadit upload failed with status ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const assembly = (await response.json()) as Record<string, unknown>;
  if (typeof assembly.error === "string" && assembly.error.length > 0) {
    throw new Error(`Transloadit upload failed: ${assembly.error}`);
  }

  const assemblyUrl =
    typeof assembly.assembly_ssl_url === "string" ? assembly.assembly_ssl_url : null;

  if (!assemblyUrl) {
    throw new Error("Transloadit did not return an assembly URL");
  }

  const result = (await pollAssembly(assemblyUrl)) as {
    results?: Record<string, Array<{ ssl_url?: string }>>;
    uploads?: Array<{ ssl_url?: string }>;
  };

  const uploadedUrl =
    result.results?.[":original"]?.[0]?.ssl_url ?? result.uploads?.[0]?.ssl_url;

  if (!uploadedUrl) {
    throw new Error("Transloadit did not return a public video URL");
  }

  return uploadedUrl;
}

async function probeVideo(filePath: string): Promise<VideoInfo> {
  const metadata = await new Promise<ProbeData>((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, data) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${error.message}`));
        return;
      }
      resolve(data as ProbeData);
    });
  });

  const videoStream = metadata.streams?.find((stream) => stream.codec_type === "video");
  if (!videoStream) {
    throw new Error("One of the provided files does not contain a video stream");
  }

  const hasAudio = metadata.streams?.some((stream) => stream.codec_type === "audio") ?? false;
  const durationValue =
    Number(videoStream.duration) || Number(metadata.format?.duration) || 0;
  const fps = parseFrameRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate);

  return {
    width: videoStream.width && videoStream.width > 0 ? videoStream.width : DEFAULT_WIDTH,
    height: videoStream.height && videoStream.height > 0 ? videoStream.height : DEFAULT_HEIGHT,
    fps,
    duration: durationValue > 0 ? durationValue : 1,
    hasAudio,
  };
}

function parseFrameRate(value?: string): number {
  if (!value || value === "0/0") {
    return DEFAULT_FPS;
  }

  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw ?? "1");

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return DEFAULT_FPS;
  }

  const fps = numerator / denominator;
  if (!Number.isFinite(fps) || fps <= 0) {
    return DEFAULT_FPS;
  }

  return Math.max(1, Math.round(fps * 1000) / 1000);
}

async function downloadVideo(url: string, filePath: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to fetch video (${response.status}): ${body.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(filePath, buffer);
}

async function mergeVideos(
  inputPaths: string[],
  videoInfos: VideoInfo[],
  outputPath: string
): Promise<void> {
  const targetWidth = videoInfos[0]?.width || DEFAULT_WIDTH;
  const targetHeight = videoInfos[0]?.height || DEFAULT_HEIGHT;
  const targetFps = videoInfos[0]?.fps || DEFAULT_FPS;

  await new Promise<void>((resolve, reject) => {
    const command = ffmpeg();

    // Only add the actual video files as inputs — no lavfi inputs
    for (const inputPath of inputPaths) {
      command.input(inputPath);
    }

    const filters: string[] = [];
    let concatInputs = "";

    for (let index = 0; index < inputPaths.length; index += 1) {
      const info = videoInfos[index];
      const duration = info.duration.toFixed(3);

      // Scale + normalize video stream
      filters.push(
        `[${index}:v]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,` +
        `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `fps=${targetFps},setsar=1,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`
      );

      if (info.hasAudio) {
        // Use the existing audio stream
        filters.push(
          `[${index}:a]aresample=48000,` +
          `aformat=sample_rates=48000:channel_layouts=stereo,` +
          `atrim=duration=${duration},asetpts=N/SR/TB[a${index}]`
        );
      } else {
        // Generate silent audio inline in the filtergraph (no lavfi input needed)
        filters.push(
          `aevalsrc=0:s=48000:d=${duration},aformat=sample_rates=48000:channel_layouts=stereo[a${index}]`
        );
      }

      concatInputs += `[v${index}][a${index}]`;
    }

    filters.push(
      `${concatInputs}concat=n=${inputPaths.length}:v=1:a=1[vout][aout]`
    );

    command
      .complexFilter(filters)
      .outputOptions([
        "-map [vout]",
        "-map [aout]",
        "-c:v libx264",
        "-preset veryfast",
        "-crf 23",
        "-c:a aac",
        "-b:a 192k",
        "-movflags +faststart",
        "-pix_fmt yuv420p",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error, _stdout, stderr) => {
        reject(new Error(`FFmpeg video merge failed: ${stderr || error.message}`));
      })
      .run();
  });
}

export const ffmpegMergeVideosTask = task({
  id: "ffmpeg-merge-videos",
  machine: {
    preset: "large-2x", // Gives you 4 vCPUs and 8GB of RAM
  },
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: unknown) => {
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Merge Videos input validation failed: ${issues}`);
    }

    const input = inputResult.data;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-merge-videos-"));
    const outputPath = path.join(tempDir, "merged-video.mp4");
    const inputPaths = input.video_urls.map((_, index) =>
      path.join(tempDir, `input-${index}.video`)
    );

    try {
      logger.info("Starting multi-video merge", {
        videoCount: input.video_urls.length,
      });

      await Promise.all(
        input.video_urls.map((videoUrl, index) =>
          downloadVideo(videoUrl, inputPaths[index])
        )
      );

      const videoInfos = await Promise.all(inputPaths.map((inputPath) => probeVideo(inputPath)));

      logger.info("Video merge normalization target resolved", {
        targetWidth: videoInfos[0]?.width || DEFAULT_WIDTH,
        targetHeight: videoInfos[0]?.height || DEFAULT_HEIGHT,
        targetFps: videoInfos[0]?.fps || DEFAULT_FPS,
      });

      await mergeVideos(inputPaths, videoInfos, outputPath);

      const mergedVideoUrl = await uploadVideoToTransloadit(
        outputPath,
        `merged-videos-${Date.now()}.mp4`
      );

      const outputResult = taskOutputSchema.safeParse({
        merged_video_url: mergedVideoUrl,
      });
      if (!outputResult.success) {
        throw new Error("Merge Videos produced an invalid output URL");
      }

      logger.info("Multi-video merge complete", {
        mergedVideoUrl,
      });

      return outputResult.data;
    } catch (error) {
      logger.error("Multi-video merge task failed", {
        error: error instanceof Error ? error.message : String(error),
        videoCount: input.video_urls.length,
      });

      throw error instanceof Error
        ? error
        : new Error(`Merge Videos failed: ${String(error)}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
  },
});
