"use strict";
// ============================================================================
// lib/theme.ts — Single Source of Truth for All DataType & Node Colors
// ============================================================================
//
// ARCHITECTURAL CONSTRAINT: Every color in the UI layer is defined HERE.
// Components import from this file exclusively. Zero hardcoded hex values
// elsewhere. CSS variables in globals.css mirror these values for use in
// stylesheets and React Flow native classes.
//
// Color philosophy:
//   - Desaturated jewel tones on near-black surfaces
//   - Muted = primary at ~40% opacity equivalent (pre-composited on #0a0a0a)
//   - Every color tested for readability on both #0a0a0a and #fafafa
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataTypeMutedColors = exports.DataTypeColors = void 0;
exports.getDataTypeTheme = getDataTypeTheme;
exports.getCategoryTheme = getCategoryTheme;
exports.getIOTypeForHandle = getIOTypeForHandle;
// ---------------------------------------------------------------------------
// DATA_TYPE_THEMES — keyed by IOType union from types.ts
// ---------------------------------------------------------------------------
const DATA_TYPE_THEMES = {
    image: {
        primary: "#a78bfa",
        muted: "#493a6e",
        cssVar: "--color-dt-image",
        textClass: "text-violet-400",
        label: "Image",
    },
    video: {
        primary: "#fb7185",
        muted: "#6e3340",
        cssVar: "--color-dt-video",
        textClass: "text-rose-400",
        label: "Video",
    },
    audio: {
        primary: "#fbbf24",
        muted: "#6e5218",
        cssVar: "--color-dt-audio",
        textClass: "text-amber-400",
        label: "Audio",
    },
    text: {
        primary: "#38bdf8",
        muted: "#1e4f6e",
        cssVar: "--color-dt-text",
        textClass: "text-sky-400",
        label: "Text",
    },
    number: {
        primary: "#34d399",
        muted: "#1e5c46",
        cssVar: "--color-dt-number",
        textClass: "text-emerald-400",
        label: "Number",
    },
    boolean: {
        primary: "#94a3b8",
        muted: "#414952",
        cssVar: "--color-dt-boolean",
        textClass: "text-slate-400",
        label: "Boolean",
    },
    select: {
        primary: "#38bdf8",
        muted: "#1e4f6e",
        cssVar: "--color-dt-select",
        textClass: "text-sky-400",
        label: "Select",
    },
    file: {
        primary: "#a78bfa",
        muted: "#493a6e",
        cssVar: "--color-dt-file",
        textClass: "text-violet-400",
        label: "File",
    },
};
// ---------------------------------------------------------------------------
// CATEGORY_THEMES — maps NodeCategory to a header accent hex
// ---------------------------------------------------------------------------
const CATEGORY_THEMES = {
    ai: "#a78bfa",
    media: "#fb7185",
    utility: "#94a3b8",
    logic: "#38bdf8",
    input: "#a1a1aa",
};
// ---------------------------------------------------------------------------
// DataTypeColors — flat map of IOType → primary hex, used for edge strokes
// ---------------------------------------------------------------------------
exports.DataTypeColors = {
    image: DATA_TYPE_THEMES.image.primary,
    video: DATA_TYPE_THEMES.video.primary,
    audio: DATA_TYPE_THEMES.audio.primary,
    text: DATA_TYPE_THEMES.text.primary,
    number: DATA_TYPE_THEMES.number.primary,
    boolean: DATA_TYPE_THEMES.boolean.primary,
    select: DATA_TYPE_THEMES.select.primary,
    file: DATA_TYPE_THEMES.file.primary,
};
// ---------------------------------------------------------------------------
// DataTypeMutedColors — flat map of IOType → muted hex, used for idle borders
// ---------------------------------------------------------------------------
exports.DataTypeMutedColors = {
    image: DATA_TYPE_THEMES.image.muted,
    video: DATA_TYPE_THEMES.video.muted,
    audio: DATA_TYPE_THEMES.audio.muted,
    text: DATA_TYPE_THEMES.text.muted,
    number: DATA_TYPE_THEMES.number.muted,
    boolean: DATA_TYPE_THEMES.boolean.muted,
    select: DATA_TYPE_THEMES.select.muted,
    file: DATA_TYPE_THEMES.file.muted,
};
// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------
function getDataTypeTheme(type) {
    return DATA_TYPE_THEMES[type] ?? DATA_TYPE_THEMES.text;
}
function getCategoryTheme(category) {
    return CATEGORY_THEMES[category] ?? CATEGORY_THEMES.utility;
}
/**
 * Resolves an IOType from a source handle key by looking up the node config.
 * Used by edge components to determine stroke color.
 */
function getIOTypeForHandle(nodeType, handleKey, direction) {
    // Lazy import to avoid circular dependency at module init
    const { nodeRegistry } = require("@/lib/nodes/registry");
    const config = nodeRegistry.get(nodeType);
    if (!config)
        return null;
    if (direction === "output") {
        const output = config.outputs.find((o) => o.key === handleKey);
        return output?.type ?? null;
    }
    const input = config.inputs.find((i) => i.key === handleKey);
    if (input) {
        return input.type;
    }
    // ── Dynamic Handles Fallback ───────────────────────────────────────
    // If the handle isn't explicitly defined in config.inputs, check if it's
    // a known dynamic handle allowed by the config.
    if (config.allowDynamicHandles) {
        if (handleKey.startsWith("dialogue_text_")) {
            return "text";
        }
        // Kling elements: element_N_frontal and element_N_ref_M are image handles
        if (handleKey.startsWith("element_")) {
            return "image";
        }
    }
    return null;
}
