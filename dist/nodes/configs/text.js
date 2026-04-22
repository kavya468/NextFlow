"use strict";
// ============================================================================
// lib/nodes/configs/text.ts — Text Input (Passthrough) Node Configuration
// ============================================================================
//
// Replaces:
//   - components/nodes/TextNode.tsx (51 lines of hand-coded React)
//   - The passthrough branch in orchestrator.ts lines 139-147
//   - The hardcoded "Text" entry in LeftSidebar.tsx
//
// This is a PASSTHROUGH node — it does not dispatch to Trigger.dev.
// The orchestrator calls registry.resolvePassthrough() which maps the
// user-entered text directly to the output key. Downstream nodes receive
// the value immediately without any async task execution.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.textConfig = void 0;
exports.textConfig = {
    id: "text",
    name: "Text",
    description: "Enter text to pass to downstream nodes",
    category: "input",
    icon: "Type",
    version: "1.0.0",
    // ---------------------------------------------------------------------------
    // INPUTS — Single textarea for user-entered text
    // ---------------------------------------------------------------------------
    inputs: [
        {
            key: "text",
            type: "text",
            label: "Text",
            required: false,
            default: "",
            isAdvanced: false,
            placeholder: "Type a prompt...",
            description: "The text value to pass downstream",
            uiVariant: "textarea",
        },
    ],
    // ---------------------------------------------------------------------------
    // OUTPUTS — The entered text flows out as "text_output"
    // ---------------------------------------------------------------------------
    outputs: [
        {
            key: "text_output",
            type: "text",
            label: "Text Output",
        },
    ],
    // ---------------------------------------------------------------------------
    // PASSTHROUGH — No Trigger.dev dispatch; immediate input→output mapping
    // ---------------------------------------------------------------------------
    isPassthrough: true,
    passthroughMapping: {
        text: "text_output",
    },
    // No providers needed — passthrough nodes skip task dispatch entirely
    providers: [],
    // ---------------------------------------------------------------------------
    // CREDITS — Passthrough nodes are free
    // ---------------------------------------------------------------------------
    credits: {
        estimate: () => 0,
        calculate: () => 0,
    },
    // ---------------------------------------------------------------------------
    // UI — Compact input node
    // ---------------------------------------------------------------------------
    ui: {
        color: "text-yellow-400",
        width: 240,
    },
};
