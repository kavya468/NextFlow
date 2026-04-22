import type { NodeConfig } from "../types";

export const mergeAudioVideoConfig: NodeConfig = {
  id: "merge-audio-video",
  name: "Merge Audio & Video",
  description: "Replace a video's audio track with a provided audio file using internal FFmpeg",
  category: "media",
  icon: "Clapperboard",
  version: "1.0.0",

  inputs: [
    {
      key: "video_url",
      type: "video",
      label: "Video URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/video.mp4",
      description: "The source video whose audio track will be replaced",
    },
    {
      key: "audio_url",
      type: "audio",
      label: "Audio URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/audio.mp3",
      description: "The audio file to merge into the output video",
    },
  ],

  outputs: [
    {
      key: "video_url",
      type: "video",
      label: "Merged Video",
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
          id: "merge-audio-video-default",
          name: "Merge Audio & Video",
          taskId: "ffmpeg-merge-audio-video",
          inputMapping: {
            video_url: "video_url",
            audio_url: "audio_url",
          },
          outputMapping: {
            video_url: "video_url",
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
    color: "text-emerald-600",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "video_url",
  },
};
