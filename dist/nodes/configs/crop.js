"use strict";
// ============================================================================
// lib/nodes/configs/crop.ts — Crop Image Node Configuration
// ============================================================================
//
// This is the first node ported to the Config-Driven system.
// It replaces:
//   - components/nodes/CropNode.tsx (135 lines of hand-coded React)
//   - The if/else branch in orchestrator.ts lines 119-129
//   - The hardcoded entry in LeftSidebar.tsx line 65
//
// From this single ~80 line config file, the system auto-generates:
//   - The complete React Flow node UI (via GenericNode.tsx)
//   - The sidebar palette entry ("Crop Image" with icon)
//   - The Zod input schema (image_url: string, x_percent: number, etc.)
//   - The orchestrator dispatch (taskId: "crop-image", mapped payload)
//   - Credit cost estimation
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.cropConfig = void 0;
exports.cropConfig = {
    id: "crop",
    name: "Crop Image",
    description: "Crop an image by specifying percentage-based coordinates",
    category: "media",
    icon: "Crop",
    version: "1.0.0",
    // ---------------------------------------------------------------------------
    // INPUTS — Each generates a React Flow Handle + UI Control + Zod field
    // ---------------------------------------------------------------------------
    inputs: [
        {
            key: "image_url",
            type: "image",
            label: "Image URL",
            required: true,
            isAdvanced: false,
            placeholder: "https://example.com/image.jpg",
            description: "The source image URL to crop",
        },
        {
            key: "x_percent",
            type: "number",
            label: "X %",
            required: false,
            default: 0,
            isAdvanced: false,
            description: "Horizontal offset from left edge (0-100%)",
            validation: { min: 0, max: 100, step: 1 },
        },
        {
            key: "y_percent",
            type: "number",
            label: "Y %",
            required: false,
            default: 0,
            isAdvanced: false,
            description: "Vertical offset from top edge (0-100%)",
            validation: { min: 0, max: 100, step: 1 },
        },
        {
            key: "width_percent",
            type: "number",
            label: "Width %",
            required: false,
            default: 100,
            isAdvanced: false,
            description: "Width of the crop region (0-100%)",
            validation: { min: 1, max: 100, step: 1 },
        },
        {
            key: "height_percent",
            type: "number",
            label: "Height %",
            required: false,
            default: 100,
            isAdvanced: false,
            description: "Height of the crop region (0-100%)",
            validation: { min: 1, max: 100, step: 1 },
        },
    ],
    // ---------------------------------------------------------------------------
    // OUTPUTS — Each generates a React Flow Handle + optional result preview
    // ---------------------------------------------------------------------------
    outputs: [
        {
            key: "url",
            type: "image",
            label: "Cropped Image",
        },
    ],
    // ---------------------------------------------------------------------------
    // PROVIDERS — Ordered fallback chain (only FFmpeg/internal for crop)
    // ---------------------------------------------------------------------------
    providers: [
        {
            id: "ffmpeg",
            name: "FFmpeg (Internal)",
            timeout: 60000,
            retryCount: 2,
            endpoints: [
                {
                    id: "crop-default",
                    name: "Crop Image",
                    taskId: "crop-image",
                    inputMapping: {
                        image_url: "imageUrl",
                        x_percent: "x",
                        y_percent: "y",
                        width_percent: "w",
                        height_percent: "h",
                    },
                    outputMapping: {
                        url: "url",
                    },
                },
            ],
        },
    ],
    // ---------------------------------------------------------------------------
    // CREDITS — Cost estimation and calculation
    // ---------------------------------------------------------------------------
    credits: {
        estimate: () => 0,
        calculate: () => 0,
    },
    // ---------------------------------------------------------------------------
    // UI — Visual metadata for the GenericNode renderer
    // ---------------------------------------------------------------------------
    ui: {
        color: "text-orange-400",
        width: 280,
        showOutputPreview: true,
        previewOutputKey: "url",
    },
};
