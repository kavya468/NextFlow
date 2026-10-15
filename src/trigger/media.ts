import { publicFetch, LOCAL_MEDIA_INPUT_OPTIONS } from "../../lib/safe-fetch";
import { logger, task } from "@trigger.dev/sdk";
import crypto from "crypto";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import path from "path";
import os from "os";

const TRANSLOADIT_AUTH_KEY = process.env.NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY!;
const TRANSLOADIT_AUTH_SECRET = process.env.TRANSLOADIT_AUTH_SECRET!;

// Set FFmpeg paths from Trigger.dev extension (FFMPEG_PATH, FFPROBE_PATH)
if (process.env.FFMPEG_PATH) {
  ffmpeg.setFfmpegPath(process.env.FFMPEG_PATH);
}
if (process.env.FFPROBE_PATH) {
  ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
}

function createTransloaditParams(steps: Record<string, unknown>) {
  const params = {
    auth: {
      key: TRANSLOADIT_AUTH_KEY,
      expires:
        new Date(Date.now() + 1000 * 60 * 30)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19) + "+00:00",
    },
    steps,
  };

  const paramsString = JSON.stringify(params);
  const signature = crypto
    .createHmac("sha384", TRANSLOADIT_AUTH_SECRET)
    .update(paramsString)
    .digest("hex");

  return { params: paramsString, signature: `sha384:${signature}` };
}

async function pollAssembly(
  assemblyUrl: string,
  maxWait = 120000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await publicFetch(assemblyUrl, { maxBytes: 1024 * 1024 });
    const data = await res.json();

    if (data.ok === "ASSEMBLY_COMPLETED") {
      return data;
    }
    if (data.error) {
      throw new Error(`Transloadit error: ${data.error}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transloadit assembly timed out");
}

/** Upload a local image file to Transloadit and return the public URL */
async function uploadImageToTransloadit(
  inputPath: string,
  filename: string,
): Promise<string> {
  const fileBuffer = await fs.readFile(inputPath);
  const blob = new Blob([fileBuffer], { type: "image/jpeg" });

  // :original captures uploaded file; resize pass-through returns ssl_url
  const { params, signature } = createTransloaditParams({
    ":original": {
      robot: "/upload/handle",
    },
    resize: {
      robot: "/image/resize",
      use: ":original",
      width: 10000,
      height: 10000,
      resize_strategy: "fit",
      result: true,
    },
  });

  const formData = new FormData();
  formData.append("params", params);
  formData.append("signature", signature);
  formData.append("file", blob, filename);

  const res = await fetch("https://api2.transloadit.com/assemblies", {
    method: "POST",
    body: formData,
  });

  const assembly = await res.json();
  if (assembly.error) {
    throw new Error(`Transloadit assembly error: ${assembly.error}`);
  }

  const result = await pollAssembly(assembly.assembly_ssl_url);
  const results = result.results?.resize;
  if (results?.[0]?.ssl_url) {
    return results[0].ssl_url;
  }
  throw new Error("Transloadit did not return a URL");
}

export const cropImageTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "crop-image",
  retry: {
    // Upload creation is not idempotent; an unknown response must not replay it.
    maxAttempts: 1,
  },
  run: async (payload: {
    imageUrl: string;
    x: number;
    y: number;
    w: number;
    h: number;
  }) => {
    logger.info("Starting FFmpeg image crop", { payload });

    if (!payload.imageUrl || typeof payload.imageUrl !== "string") {
      logger.error("Missing or invalid imageUrl payload");
      throw new Error("Failed to crop: A valid image URL is required.");
    }

    try {
      new URL(payload.imageUrl);
    } catch (e) {
      logger.error("Malformed URL provided for imageUrl", { url: payload.imageUrl });
      throw new Error(`Failed to crop: Invalid image URL format -> ${payload.imageUrl}`);
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextflow-crop-"));
    const inputPath = path.join(tempDir, "input.jpg");
    const outputPath = path.join(tempDir, "output.jpg");

    try {
      const imgResponse = await publicFetch(payload.imageUrl, { maxBytes: 20 * 1024 * 1024 });
      if (!imgResponse.ok)
        throw new Error(`Failed to fetch image: ${imgResponse.status}`);
      await fs.writeFile(
        inputPath,
        Buffer.from(await imgResponse.arrayBuffer()),
      );

      const dimensions = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          ffmpeg.ffprobe(inputPath, LOCAL_MEDIA_INPUT_OPTIONS, (err, metadata) => {
            if (err) return reject(new Error(`ffprobe error: ${err.message}`));

            const stream = metadata.streams?.find((s) => s.width && s.height);
            if (!stream?.width || !stream?.height) {
              return reject(
                new Error("Could not get image dimensions from file"),
              );
            }
            resolve({ width: stream.width, height: stream.height });
          });
        },
      );


      const rawX = Number(payload.x) || 0;
      const rawY = Number(payload.y) || 0;
      const rawW = Number(payload.w) || 100;
      const rawH = Number(payload.h) || 100;

      let x = Math.floor((rawX / 100) * dimensions.width);
      let y = Math.floor((rawY / 100) * dimensions.height);
      let w = Math.floor((rawW / 100) * dimensions.width);
      let h = Math.floor((rawH / 100) * dimensions.height);

      x = Math.max(0, Math.min(x, dimensions.width - 1));
      y = Math.max(0, Math.min(y, dimensions.height - 1));
      w = Math.max(1, Math.min(w, dimensions.width - x));
      h = Math.max(1, Math.min(h, dimensions.height - y));

      logger.info("FFmpeg crop dimensions", {
        x,
        y,
        w,
        h,
        original: dimensions,
        rawPercent: { rawX, rawY, rawW, rawH },
      });

      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .inputOptions(LOCAL_MEDIA_INPUT_OPTIONS)
          .outputOptions([`-vf`, `crop=${w}:${h}:${x}:${y}`])
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", (err, stdout, stderr) => {
            logger.error("FFmpeg Crop Failed", { error: err.message, stderr });
            reject(new Error(`FFmpeg crop failed: ${stderr || err.message}`));
          })
          .run();
      });


      const url = await uploadImageToTransloadit(
        outputPath,
        `cropped_${Date.now()}.jpg`,
      );

      logger.info("FFmpeg crop complete", { url });
      return { url };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});

export const extractFrameTask = task({
  machine: {
    preset: "large-2x",
  },
  id: "extract-frame",
  retry: {
    // Upload creation is not idempotent; an unknown response must not replay it.
    maxAttempts: 1,
  },
  run: async (payload: { videoUrl: string; timestamp: string }) => {
    logger.info("Starting FFmpeg frame extraction", { payload });

    if (!payload.videoUrl || typeof payload.videoUrl !== "string") {
      logger.error("Missing or invalid videoUrl payload");
      throw new Error("Failed to extract frame: A valid video URL is required.");
    }

    try {
      new URL(payload.videoUrl);
    } catch (e) {
      logger.error("Malformed URL provided for videoUrl", { url: payload.videoUrl });
      throw new Error(`Failed to extract frame: Invalid video URL format -> ${payload.videoUrl}`);
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextflow-extract-frame-"));
    const inputPath = path.join(tempDir, "input.mp4");
    const outputPath = path.join(tempDir, "output.jpg");

    try {
      const videoResponse = await publicFetch(payload.videoUrl);
      if (!videoResponse.ok)
        throw new Error(`Failed to fetch video: ${videoResponse.status}`);
      await fs.writeFile(
        inputPath,
        Buffer.from(await videoResponse.arrayBuffer()),
      );

      let seekSeconds: number;
      if (payload.timestamp.endsWith("%")) {
        const parsedPercent = parseFloat(payload.timestamp.slice(0, -1));
        const percent = Number.isFinite(parsedPercent) ? parsedPercent : 50;

        const timing = await new Promise<{ duration: number; lastFrameAt: number }>((resolve, reject) => {
          ffmpeg.ffprobe(inputPath, LOCAL_MEDIA_INPUT_OPTIONS, (err, metadata) => {
            if (err) return reject(new Error(`ffprobe error: ${err.message}`));

            const video = metadata.streams.find(stream => stream.codec_type === "video");
            const duration = Number(video?.duration) || Number(metadata.format?.duration);
            if (!Number.isFinite(duration) || duration <= 0) return reject(new Error("Could not determine video duration"));
            const [numerator, denominator = 1] = String(video?.avg_frame_rate || video?.r_frame_rate || "24/1").split("/").map(Number);
            const fps = numerator / denominator;
            const frameDuration = Number.isFinite(fps) && fps > 0 ? 1 / fps : 1 / 24;
            resolve({ duration, lastFrameAt: Math.max(0, duration - frameDuration) });
          });
        });

        // Exact EOF has no frame; 100% selects the final available frame.
        seekSeconds = Math.min((percent / 100) * timing.duration, timing.lastFrameAt);
      } else {
        seekSeconds = parseFloat(payload.timestamp) || 0;
      }

      seekSeconds = Math.max(0, Math.min(seekSeconds, 3600)); // clamp safely

      logger.info("FFmpeg extracting at exact timestamp", { seekSeconds });


      await new Promise<void>((resolve, reject) => {
        ffmpeg(inputPath)
          .inputOptions(LOCAL_MEDIA_INPUT_OPTIONS)
          .seekInput(seekSeconds)
          .outputOptions(["-vframes", "1", "-q:v", "2"]) // Added high-quality flag
          .output(outputPath)
          .on("end", () => resolve())
          .on("error", (err, stdout, stderr) => {
            logger.error("FFmpeg Extract Failed", {
              error: err.message,
              stderr,
            });
            reject(
              new Error(`FFmpeg extract failed: ${stderr || err.message}`),
            );
          })
          .run();
      });


      const url = await uploadImageToTransloadit(
        outputPath,
        `frame_${Date.now()}.jpg`,
      );

      logger.info("FFmpeg frame extraction complete", { url });
      return { url };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  },
});
