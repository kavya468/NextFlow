import { defineConfig } from "@trigger.dev/sdk";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_yasmuuvbywhymfswqkam",
  runtime: "node",
  logLevel: "log",
  maxDuration: 300,
  build: {
    extensions: [ffmpeg()],
    external: ["fluent-ffmpeg"],
  },
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  dirs: ["./src/trigger"],
});
