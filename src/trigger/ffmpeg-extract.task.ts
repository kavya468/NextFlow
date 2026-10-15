import { publicFetch, LOCAL_MEDIA_INPUT_OPTIONS } from "../../lib/safe-fetch";
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
});

const taskOutputSchema = z.object({
  audio_url: z.string().url(),
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
    const response = await publicFetch(assemblyUrl, {
      maxBytes: 1024 * 1024,
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

async function uploadAudioToTransloadit(filePath: string, filename: string): Promise<string> {
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
  formData.append("file", new Blob([fileBuffer], { type: "audio/mpeg" }), filename);

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
    throw new Error("Transloadit did not return a public audio URL");
  }

  return uploadedUrl;
}

async function ensureVideoHasAudio(inputPath: string): Promise<void> {
  const metadata = await new Promise<{
    streams?: Array<{ codec_type?: string }>;
  }>((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, LOCAL_MEDIA_INPUT_OPTIONS, (error, data) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${error.message}`));
        return;
      }
      resolve(data);
    });
  });

  const audioStream = metadata.streams?.find((stream) => stream.codec_type === "audio");
  if (!audioStream) {
    throw new Error("The provided video does not contain an audio track");
  }
}

async function extractAudioTrack(inputPath: string, outputPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    ffmpeg(inputPath)
      .inputOptions(LOCAL_MEDIA_INPUT_OPTIONS)
      .noVideo()
      .outputOptions(["-map 0:a:0", "-q:a 2"])
      .audioCodec("libmp3lame")
      .output(outputPath)
      .on("end", () => resolve())
      .on("error", (error, _stdout, stderr) => {
        reject(new Error(`FFmpeg audio extraction failed: ${stderr || error.message}`));
      })
      .run();
  });
}

export const ffmpegExtractAudioTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "ffmpeg-extract-audio",
  retry: {
    maxAttempts: 1,
  },
  run: async (payload: unknown) => {
    const inputResult = taskInputSchema.safeParse(payload);
    if (!inputResult.success) {
      const issues = inputResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Extract Audio input validation failed: ${issues}`);
    }

    const input = inputResult.data;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffmpeg-extract-audio-"));
    const inputPath = path.join(tempDir, "input-video");
    const outputPath = path.join(tempDir, "output-audio.mp3");

    try {
      logger.info("Starting audio extraction", {
        videoUrl: input.video_url,
      });

      const videoResponse = await publicFetch(input.video_url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });

      if (!videoResponse.ok) {
        throw new Error(`Failed to fetch video: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      await fs.writeFile(inputPath, videoBuffer);

      await ensureVideoHasAudio(inputPath);
      await extractAudioTrack(inputPath, outputPath);

      const audioUrl = await uploadAudioToTransloadit(
        outputPath,
        `extracted-audio-${Date.now()}.mp3`
      );

      const outputResult = taskOutputSchema.safeParse({ audio_url: audioUrl });
      if (!outputResult.success) {
        throw new Error("Extract Audio produced an invalid output URL");
      }

      logger.info("Audio extraction complete", {
        audioUrl,
      });

      return outputResult.data;
    } catch (error) {
      logger.error("Audio extraction task failed", {
        error: error instanceof Error ? error.message : String(error),
        videoUrl: input.video_url,
      });

      throw error instanceof Error
        ? error
        : new Error(`Extract Audio failed: ${String(error)}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});
