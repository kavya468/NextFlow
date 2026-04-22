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

const taskInputSchema = z.object({
  video_url: z.string().url(),
  audio_url: z.string().url(),
});

const taskOutputSchema = z.object({
  video_url: z.string().url(),
});

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
    throw new Error(`Transloadit upload failed with status ${response.status}: ${body.slice(0, 200)}`);
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

async function ensureMediaStreams(videoPath: string, audioPath: string): Promise<void> {
  const [videoMetadata, audioMetadata] = await Promise.all([
    new Promise<{
      streams?: Array<{ codec_type?: string }>;
    }>((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (error, data) => {
        if (error) {
          reject(new Error(`ffprobe failed for video: ${error.message}`));
          return;
        }
        resolve(data);
      });
    }),
    new Promise<{
      streams?: Array<{ codec_type?: string }>;
    }>((resolve, reject) => {
      ffmpeg.ffprobe(audioPath, (error, data) => {
        if (error) {
          reject(new Error(`ffprobe failed for audio: ${error.message}`));
          return;
        }
        resolve(data);
      });
    }),
  ]);

  const hasVideoStream = videoMetadata.streams?.some((stream) => stream.codec_type === "video");
  const hasAudioStream = audioMetadata.streams?.some((stream) => stream.codec_type === "audio");

  if (!hasVideoStream) {
    throw new Error("The provided video file does not contain a video stream");
  }

  if (!hasAudioStream) {
    throw new Error("The provided audio file does not contain an audio stream");
  }
}

async function mergeAudioWithVideo(
  videoPath: string,
  audioPath: string,
  outputPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-map 0:v:0",
        "-map 1:a:0",
        "-c:v copy",
        "-c:a aac",
        "-shortest",
        "-movflags +faststart",
      ])
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error, _stdout, stderr) => {
        reject(new Error(`FFmpeg audio/video merge failed: ${stderr || error.message}`));
      })
      .run();
  });
}

export const ffmpegMergeAudioVideoTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "ffmpeg-merge-audio-video",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: unknown) => {
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Merge Audio & Video input validation failed: ${issues}`);
    }

    const input = inputResult.data;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-merge-audio-video-"));
    const videoPath = path.join(tempDir, "input-video");
    const audioPath = path.join(tempDir, "input-audio");
    const outputPath = path.join(tempDir, "output-video.mp4");

    try {
      logger.info("Starting audio/video merge", {
        videoUrl: input.video_url,
        audioUrl: input.audio_url,
      });

      const [videoResponse, audioResponse] = await Promise.all([
        fetch(input.video_url, {
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        }),
        fetch(input.audio_url, {
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        }),
      ]);

      if (!videoResponse.ok) {
        throw new Error(`Failed to fetch video: ${videoResponse.status}`);
      }

      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio: ${audioResponse.status}`);
      }

      const [videoBuffer, audioBuffer] = await Promise.all([
        videoResponse.arrayBuffer(),
        audioResponse.arrayBuffer(),
      ]);

      await Promise.all([
        fs.writeFile(videoPath, Buffer.from(videoBuffer)),
        fs.writeFile(audioPath, Buffer.from(audioBuffer)),
      ]);

      await ensureMediaStreams(videoPath, audioPath);
      await mergeAudioWithVideo(videoPath, audioPath, outputPath);

      const mergedVideoUrl = await uploadVideoToTransloadit(
        outputPath,
        `merged-video-${Date.now()}.mp4`
      );

      const outputResult = taskOutputSchema.safeParse({ video_url: mergedVideoUrl });
      if (!outputResult.success) {
        throw new Error("Merge Audio & Video produced an invalid output URL");
      }

      logger.info("Audio/video merge complete", {
        videoUrl: mergedVideoUrl,
      });

      return outputResult.data;
    } catch (error) {
      logger.error("Audio/video merge task failed", {
        error: error instanceof Error ? error.message : String(error),
        videoUrl: input.video_url,
        audioUrl: input.audio_url,
      });

      throw error instanceof Error
        ? error
        : new Error(`Merge Audio & Video failed: ${String(error)}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});
