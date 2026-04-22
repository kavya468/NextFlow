"use strict";
// ============================================================================
// lib/nodes/configs/image.ts — Image Upload (Passthrough) Node Configuration
// ============================================================================
//
// This is a PASSTHROUGH SOURCE node — it does not dispatch to Trigger.dev
// and does not accept incoming connections (no input handles).
//
// The user uploads an image via the GenericNode MediaSourceArea, which stores
// the resulting CDN URL in node.data.url. The orchestrator reads this via
// passthroughMapping: { url → image_url } for downstream consumers.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageConfig = void 0;
exports.imageConfig = {
    id: "image",
    name: "Image",
    description: "Upload an image or provide an image URL",
    category: "input",
    icon: "Image",
    version: "1.0.0",
    // ---------------------------------------------------------------------------
    // INPUTS — None. This is a pure source node with no incoming handles.
    // The URL is stored directly in node.data.url by the upload UI.
    // ---------------------------------------------------------------------------
    inputs: [],
    // ---------------------------------------------------------------------------
    // OUTPUTS — The image URL flows downstream as "image_url"
    // ---------------------------------------------------------------------------
    outputs: [
        {
            key: "image_url",
            type: "image",
            label: "Image URL",
        },
    ],
    // ---------------------------------------------------------------------------
    // PASSTHROUGH — No Trigger.dev dispatch; immediate input→output mapping
    // ---------------------------------------------------------------------------
    isPassthrough: true,
    passthroughMapping: {
        url: "image_url",
    },
    // No providers needed — passthrough
    providers: [],
    // ---------------------------------------------------------------------------
    // CREDITS — Passthrough nodes are free
    // ---------------------------------------------------------------------------
    credits: {
        estimate: () => 0,
        calculate: () => 0,
    },
    // ---------------------------------------------------------------------------
    // UI — Shows image preview in the node body
    // ---------------------------------------------------------------------------
    ui: {
        color: "text-blue-400",
        width: 260,
        showOutputPreview: false,
    },
};
