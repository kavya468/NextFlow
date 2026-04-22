// ============================================================================
// lib/nodes/configs/extract-audio.config.ts — Extract Audio Node Configuration
// ============================================================================
//
// Extracts the audio track from a source video using internal FFmpeg workers.
// This is a zero-credit utility node that runs entirely on our infrastructure.
// ============================================================================

import type { NodeConfig } from "../types";

export const extractAudioConfig: NodeConfig = {
  id: "extract-audio",
  name: "Extract Audio",
  description: "Extract the audio track from a video using internal FFmpeg",
  category: "media",
  icon: "AudioLines",
  version: "1.0.0",

  inputs: [
    {
      key: "video_url",
      type: "video",
      label: "Video URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/video.mp4",
      description: "The source video URL to extract audio from",
    },
  ],

  outputs: [
    {
      key: "audio_url",
      type: "audio",
      label: "Extracted Audio",
    },
  ],

  providers: [
    {
      id: "internal",
      name: "Internal FFmpeg",
      timeout: 120000,
      retryCount: 1,
      endpoints: [
        {
          id: "extract-audio-default",
          name: "Extract Audio",
          taskId: "ffmpeg-extract-audio",
          inputMapping: {
            video_url: "video_url",
          },
          outputMapping: {
            audio_url: "audio_url",
          },
        },
      ],
    },
  ],

  credits: {
    estimate: () => 0,
    calculate: () => 0,
  },

  ui: {
    color: "text-emerald-500",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "audio_url",
  },
};
