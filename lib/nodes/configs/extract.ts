// ============================================================================
// lib/nodes/configs/extract.ts — Extract Frame Node Configuration
// ============================================================================
//
// Replaces:
//   - components/nodes/ExtractNode.tsx (110 lines of hand-coded React)
//   - The if/else branch in orchestrator.ts lines 130-137
//   - The hardcoded "Extract Frame" entry in LeftSidebar.tsx
//
// From this config, the system auto-generates:
//   - The React Flow node UI (GenericNode.tsx renders timestamp input,
//     video_url handle, and extracted frame preview)
//   - The sidebar palette entry ("Extract Frame" with ImageIcon, "media")
//   - The Zod input schema (video_url: string, timestamp: string)
//   - The orchestrator dispatch (taskId: "extract-frame", mapped payload)
//   - Credit cost estimation (flat fee for internal FFmpeg ops)
// ============================================================================

import type { NodeConfig } from "../types";

export const extractConfig: NodeConfig = {
  id: "extract",
  name: "Extract Frame",
  description: "Extract a single frame from a video at a given timestamp",
  category: "media",
  icon: "Image",
  version: "1.0.0",

  // ---------------------------------------------------------------------------
  // INPUTS — Video URL + timestamp position
  // ---------------------------------------------------------------------------
  inputs: [
    {
      key: "video_url",
      type: "video",
      label: "Video URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/video.mp4",
      description: "The source video URL to extract a frame from",
    },
    {
      key: "timestamp",
      type: "text",
      label: "Timestamp",
      required: false,
      default: "50%",
      isAdvanced: false,
      placeholder: 'e.g. 5 or "50%"',
      description:
        "The position to extract — seconds (e.g. 5) or percentage (e.g. 50%)",
    },
  ],

  // ---------------------------------------------------------------------------
  // OUTPUTS — The extracted frame image URL
  // ---------------------------------------------------------------------------
  outputs: [
    {
      key: "url",
      type: "image",
      label: "Extracted Frame",
    },
  ],

  // ---------------------------------------------------------------------------
  // PROVIDERS — FFmpeg via Trigger.dev task
  // ---------------------------------------------------------------------------
  providers: [
    {
      id: "ffmpeg",
      name: "FFmpeg (Internal)",
      timeout: 120000,
      retryCount: 2,
      endpoints: [
        {
          id: "extract-default",
          name: "Extract Frame",
          taskId: "extract-frame",
          inputMapping: {
            video_url: "videoUrl",
            timestamp: "timestamp",
          },
          outputMapping: {
            url: "url",
          },
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // CREDITS — Flat cost for internal FFmpeg ops
  // ---------------------------------------------------------------------------
  credits: {
    estimate: () => 0,
    calculate: () => 0,
  },

  // ---------------------------------------------------------------------------
  // UI — Shows extracted frame preview
  // ---------------------------------------------------------------------------
  ui: {
    color: "text-pink-400",
    width: 260,
    showOutputPreview: true,
    previewOutputKey: "url",
  },
};
