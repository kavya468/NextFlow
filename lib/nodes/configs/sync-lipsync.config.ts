// ============================================================================
// lib/nodes/configs/sync-lipsync.config.ts — Sync Lipsync Node Configuration
// ============================================================================
//
// Lip-sync generation via fal.ai's sync-lipsync model.
// Takes a base video and audio file, generates a new video with
// synchronized lip movements.
//
// CREDITS:
//   - Estimate: flat 10 credits (computationally expensive)
//   - Actual: 10 credits flat (no usage-based pricing from fal.ai)
// ============================================================================

import type { NodeConfig } from "../types";

export const syncLipsyncConfig: NodeConfig = {
  id: "sync-lipsync",
  name: "Sync Lipsync",
  description: "Synchronize lip movements in video to match audio via fal.ai",
  category: "media",
  icon: "AudioLines",
  version: "2.0.0",

  inputs: [
    {
      key: "video_url",
      type: "video",
      label: "Base Video URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/video.mp4",
      description: "Source video containing the face to lip-sync",
    },
    {
      key: "audio_url",
      type: "audio",
      label: "Audio URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/audio.mp3",
      description: "Audio track to sync lips to",
    },
    {
      key: "model",
      type: "select",
      label: "Model Version",
      required: false,
      default: "lipsync-1.9.0-beta",
      isAdvanced: true,
      description: "Lipsync model version to use",
      validation: {
        options: [
          { label: "1.9.0 Beta (Latest)", value: "lipsync-1.9.0-beta" },
          { label: "1.8.0 (Stable)", value: "lipsync-1.8.0" },
          { label: "1.7.1 (Legacy)", value: "lipsync-1.7.1" },
        ],
      },
    },
    {
      key: "sync_mode",
      type: "select",
      label: "Sync Mode",
      required: false,
      default: "cut_off",
      isAdvanced: true,
      description:
        "How to handle length mismatch between video and audio",
      validation: {
        options: [
          { label: "Cut Off", value: "cut_off" },
          { label: "Loop", value: "loop" },
          { label: "Bounce", value: "bounce" },
          { label: "Silence", value: "silence" },
          { label: "Remap", value: "remap" },
        ],
      },
    },
  ],

  outputs: [
    {
      key: "video_url",
      type: "video",
      label: "Lipsynced Video",
    },
  ],

  providers: [
    {
      id: "fal-ai",
      name: "fal.ai",
      timeout: 600000,
      retryCount: 1,
      endpoints: [
        {
          id: "sync-lipsync-generate",
          name: "Lip Sync",
          taskId: "sync-lipsync-generate",
          inputMapping: {
            video_url: "video_url",
            audio_url: "audio_url",
            model: "model",
            sync_mode: "sync_mode",
          },
          outputMapping: {
            video_url: "video_url",
          },
        },
      ],
    },
  ],

  credits: {
    estimate: () => 80_000,
    calculate: (_inputs, response: unknown) => {
      const res = response as Record<string, unknown> | null;
      if (res && typeof res.cost === "number") {
        return Math.ceil(res.cost * 1_000_000);
      }
      return 80_000;
    },
  },

  ui: {
    color: "text-fuchsia-600",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "video_url",
  },
};
