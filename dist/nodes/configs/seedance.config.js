"use strict";
// ============================================================================
// lib/nodes/configs/seedance.config.ts — Seedance 1.5 Pro Video Generation
// ============================================================================
//
// Text-to-video and image-to-video via fal.ai's Seedance 1.5 Pro model.
//
// ENDPOINT SELECTION (via `mode` input):
//   - "text-to-video" → fal-ai/bytedance/seedance/v1.5/pro/text-to-video
//   - "image-to-video" → fal-ai/bytedance/seedance/v1.5/pro/image-to-video
//
// Both modes route to the same Trigger.dev task ("seedance-generate").
// The task reads `mode` to select the correct fal.ai REST endpoint and
// validates that `image_url` is present when mode is "image-to-video".
//
// CREDITS:
//   - Flat 15 credits per generation (computationally expensive model)
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedanceConfig = void 0;
exports.seedanceConfig = {
    id: "seedance-1.5",
    name: "Seedance 1.5 Pro",
    description: "Text-to-video and image-to-video generation via fal.ai",
    category: "ai",
    icon: "Video",
    version: "1.0.0",
    // ---------------------------------------------------------------------------
    // INPUTS
    // ---------------------------------------------------------------------------
    inputs: [
        {
            key: "mode",
            type: "select",
            label: "Mode",
            required: false,
            default: "text-to-video",
            isAdvanced: false,
            description: "Switch between text-to-video and image-to-video generation",
            validation: {
                options: [
                    { label: "Text to Video", value: "text-to-video" },
                    { label: "Image to Video", value: "image-to-video" },
                ],
            },
        },
        {
            key: "prompt",
            type: "text",
            label: "Prompt",
            required: true,
            isAdvanced: false,
            placeholder: "A cinematic shot of a sunrise over the ocean...",
            description: "Text description of the video to generate",
            uiVariant: "textarea",
        },
        {
            key: "image_url",
            type: "image",
            label: "Start Image URL",
            required: false,
            isAdvanced: false,
            placeholder: "https://example.com/frame.jpg",
            description: "Required for image-to-video. The first frame of the generated video.",
            showIf: { field: "mode", equals: "image-to-video" },
        },
        {
            key: "end_image_url",
            type: "image",
            label: "End Image URL",
            required: false,
            isAdvanced: true,
            placeholder: "https://example.com/last-frame.jpg",
            description: "Optional last frame anchor for image-to-video generation.",
            showIf: { field: "mode", equals: "image-to-video" },
        },
        {
            key: "aspect_ratio",
            type: "select",
            label: "Aspect Ratio",
            required: false,
            default: "16:9",
            isAdvanced: true,
            description: "Output video aspect ratio",
            validation: {
                options: [
                    { label: "16:9 (Landscape)", value: "16:9" },
                    { label: "21:9 (Ultrawide)", value: "21:9" },
                    { label: "4:3 (Classic)", value: "4:3" },
                    { label: "1:1 (Square)", value: "1:1" },
                    { label: "3:4 (Portrait Classic)", value: "3:4" },
                    { label: "9:16 (Portrait)", value: "9:16" },
                    { label: "Auto", value: "auto" },
                ],
            },
        },
        {
            key: "resolution",
            type: "select",
            label: "Resolution",
            required: false,
            default: "720p",
            isAdvanced: true,
            description: "Output video resolution",
            validation: {
                options: [
                    { label: "480p", value: "480p" },
                    { label: "720p", value: "720p" },
                    { label: "1080p", value: "1080p" },
                ],
            },
        },
        {
            key: "duration",
            type: "select",
            label: "Duration (s)",
            required: false,
            default: "5",
            isAdvanced: true,
            description: "Length of the generated video in seconds",
            validation: {
                options: [
                    { label: "4s", value: "4" },
                    { label: "5s", value: "5" },
                    { label: "6s", value: "6" },
                    { label: "7s", value: "7" },
                    { label: "8s", value: "8" },
                    { label: "9s", value: "9" },
                    { label: "10s", value: "10" },
                    { label: "11s", value: "11" },
                    { label: "12s", value: "12" },
                ],
            },
        },
        {
            key: "camera_fixed",
            type: "boolean",
            label: "Camera Fixed",
            required: false,
            default: false,
            isAdvanced: true,
            description: "Lock the camera position during generation",
        },
        {
            key: "generate_audio",
            type: "boolean",
            label: "Generate Audio",
            required: false,
            default: true,
            isAdvanced: true,
            description: "Generate ambient audio alongside the video",
        },
        {
            key: "enable_safety_checker",
            type: "boolean",
            label: "Enable Safety Checker",
            required: false,
            default: true,
            isAdvanced: true,
            description: "Enable the content safety filter on generated output",
        },
        {
            key: "seed",
            type: "text",
            label: "Seed (optional)",
            required: false,
            isAdvanced: true,
            placeholder: "e.g. 42",
            description: "Numeric seed for reproducible results. Leave empty for random.",
        },
    ],
    // ---------------------------------------------------------------------------
    // OUTPUTS
    // ---------------------------------------------------------------------------
    outputs: [
        {
            key: "video_url",
            type: "video",
            label: "Generated Video",
        },
        {
            key: "seed",
            type: "text",
            label: "Seed Used",
        },
    ],
    // ---------------------------------------------------------------------------
    // PROVIDERS — single fal-ai provider, endpoint selected by mode input
    // ---------------------------------------------------------------------------
    providers: [
        {
            id: "fal-ai",
            name: "fal.ai",
            timeout: 900000, // 15 minutes — video generation is slow
            retryCount: 1,
            endpoints: [
                {
                    id: "seedance-image-to-video",
                    name: "Image to Video",
                    taskId: "seedance-generate",
                    condition: (inputs) => inputs.mode === "image-to-video",
                    inputMapping: {
                        mode: "mode",
                        prompt: "prompt",
                        image_url: "image_url",
                        end_image_url: "end_image_url",
                        aspect_ratio: "aspect_ratio",
                        resolution: "resolution",
                        duration: "duration",
                        camera_fixed: "camera_fixed",
                        generate_audio: "generate_audio",
                        enable_safety_checker: "enable_safety_checker",
                        seed: "seed",
                    },
                    outputMapping: {
                        video_url: "video_url",
                        seed: "seed",
                    },
                },
                {
                    id: "seedance-text-to-video",
                    name: "Text to Video",
                    taskId: "seedance-generate",
                    inputMapping: {
                        mode: "mode",
                        prompt: "prompt",
                        aspect_ratio: "aspect_ratio",
                        resolution: "resolution",
                        duration: "duration",
                        camera_fixed: "camera_fixed",
                        generate_audio: "generate_audio",
                        enable_safety_checker: "enable_safety_checker",
                        seed: "seed",
                    },
                    outputMapping: {
                        video_url: "video_url",
                        seed: "seed",
                    },
                },
            ],
        },
    ],
    // ---------------------------------------------------------------------------
    // CREDITS — video generation is expensive (~$0.12 per generation)
    // ---------------------------------------------------------------------------
    credits: {
        estimate: () => 120_000,
        calculate: (_inputs, response) => {
            const res = response;
            if (res && typeof res.cost === "number") {
                return Math.ceil(res.cost * 1_000_000);
            }
            return 120_000;
        },
    },
    // ---------------------------------------------------------------------------
    // UI — orange accent, video preview for output
    // ---------------------------------------------------------------------------
    ui: {
        color: "text-orange-500",
        width: 280,
        showOutputPreview: true,
        previewOutputKey: "video_url",
    },
};
