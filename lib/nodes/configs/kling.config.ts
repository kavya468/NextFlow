import type { NodeConfig } from "../types";

export const klingConfig: NodeConfig = {
  id: "kling-01",
  name: "Kling O1 Video",
  description:
    "Video-to-video generation and editing via fal.ai Kling O1 model",
  category: "ai",
  icon: "Clapperboard",
  version: "2.0.0",

  inputs: [
    {
      key: "mode",
      type: "select",
      label: "Mode",
      required: true,
      default: "reference",
      isAdvanced: false,
      description:
        "Reference: style-transfer using reference images. Edit: prompt-guided video editing.",
      validation: {
        options: [
          { label: "Reference", value: "reference" },
          { label: "Edit", value: "edit" },
        ],
      },
    },
    {
      key: "prompt",
      type: "text",
      label: "Prompt",
      required: true,
      isAdvanced: false,
      placeholder: "Replace the character with @Element1, transform the landscape into @Image1...",
      description:
        "Use @Element1, @Element2 to reference elements and @Image1, @Image2 to reference images in order.",
      uiVariant: "mention-textarea",
      mentionSources: {
        elementsKey: "elements",
        imageKeys: ["image_urls"],
      },
    },
    {
      key: "video_url",
      type: "video",
      label: "Source Video URL",
      required: true,
      isAdvanced: false,
      placeholder: "https://example.com/video.mp4",
      description: "Source video to transform or edit",
    },
    {
      key: "image_urls",
      type: "image",
      label: "Reference Images",
      required: false,
      isAdvanced: false,
      description:
        "Reference images for style/appearance. Reference in prompt as @Image1, @Image2. Max 4 total (elements + images).",
      multi: true,
    },
    {
      key: "elements",
      type: "text",
      label: "Elements",
      required: false,
      isAdvanced: false,
      description:
        "Characters/objects to include. Each element has a frontal image and optional reference images. Reference as @Element1, @Element2 in prompt. Max 4 total.",
      uiVariant: "elements-editor",
      hideHandle: true,
    },
    {
      key: "keep_audio",
      type: "boolean",
      label: "Keep Audio",
      required: false,
      default: false,
      isAdvanced: true,
      description: "Preserve the original audio track from the source video",
    },
    {
      key: "aspect_ratio",
      type: "select",
      label: "Aspect Ratio",
      required: false,
      default: "auto",
      isAdvanced: true,
      description: "Output video aspect ratio (Reference mode only)",
      showIf: { field: "mode", equals: "reference" },
      validation: {
        options: [
          { label: "Auto", value: "auto" },
          { label: "16:9 (Landscape)", value: "16:9" },
          { label: "9:16 (Portrait)", value: "9:16" },
          { label: "1:1 (Square)", value: "1:1" },
        ],
      },
    },
    {
      key: "duration",
      type: "select",
      label: "Duration (seconds)",
      required: false,
      default: "5",
      isAdvanced: true,
      description: "Output video duration in seconds (Reference mode only)",
      showIf: { field: "mode", equals: "reference" },
      validation: {
        options: [
          { label: "3 seconds", value: "3" },
          { label: "4 seconds", value: "4" },
          { label: "5 seconds", value: "5" },
          { label: "6 seconds", value: "6" },
          { label: "7 seconds", value: "7" },
          { label: "8 seconds", value: "8" },
          { label: "9 seconds", value: "9" },
          { label: "10 seconds", value: "10" },
        ],
      },
    },
  ],

  outputs: [
    {
      key: "video_url",
      type: "video",
      label: "Generated Video",
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
          id: "kling-generate",
          name: "Kling O1 Video",
          taskId: "kling-generate",
          inputMapping: {
            mode: "mode",
            prompt: "prompt",
            video_url: "video_url",
            image_urls: "image_urls",
            elements: "elements",
            keep_audio: "keep_audio",
            aspect_ratio: "aspect_ratio",
            duration: "duration",
          },
          outputMapping: {
            video_url: "video_url",
          },
        },
      ],
    },
  ],

  credits: {
    estimate: () => 200_000,
    calculate: (_inputs, response: unknown) => {
      const res = response as Record<string, unknown> | null;
      if (res && typeof res.cost === "number") {
        return Math.ceil(res.cost * 1_000_000);
      }
      return 200_000;
    },
  },

  ui: {
    color: "text-rose-500",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "video_url",
  },

  // Dynamic handles: The ElementsEditor renders per-element image handles
  // (element_0_frontal, element_0_ref_0, ...) that need to survive Zod validation.
  allowDynamicHandles: true,
};
