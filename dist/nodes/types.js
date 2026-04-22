"use strict";
// ============================================================================
// lib/nodes/types.ts — The DNA Schema for Every Node in the System
// ============================================================================
//
// This file defines the strict TypeScript interfaces that represent a node's
// complete "DNA". Every node in the platform — from a simple Text passthrough
// to a complex Seedream 4.5 image generator — is described by a single
// NodeConfig object. The NodeRegistry reads these configs and auto-generates
// Zod schemas, React Flow components, sidebar entries, and orchestrator
// dispatch logic from them.
//
// DESIGN PRINCIPLES:
//   1. One config file = one node type. No React components per node.
//   2. Every user-facing input MUST have a corresponding React Flow Handle.
//   3. The orchestrator MUST be node-type-agnostic — it reads from the registry.
//   4. Advanced settings collapse by default but handles remain functional.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.HANDLE_COLOR_CLASSES = exports.DEFAULT_HANDLE_COLORS = void 0;
// ---------------------------------------------------------------------------
// Handle color defaults — derived from IOType when not explicitly set
// ---------------------------------------------------------------------------
exports.DEFAULT_HANDLE_COLORS = {
    text: "yellow",
    image: "blue",
    video: "blue",
    audio: "pink",
    number: "orange",
    boolean: "green",
    select: "yellow",
    file: "blue",
};
// ---------------------------------------------------------------------------
// Handle color → Tailwind class mapping for the GenericNode renderer
// ---------------------------------------------------------------------------
exports.HANDLE_COLOR_CLASSES = {
    blue: {
        bg: "!bg-blue-500",
        ring: "!ring-blue-500/40",
        ringHover: "hover:!ring-blue-500/70",
    },
    yellow: {
        bg: "!bg-yellow-500",
        ring: "!ring-yellow-500/40",
        ringHover: "hover:!ring-yellow-500/70",
    },
    pink: {
        bg: "!bg-pink-500",
        ring: "!ring-pink-500/40",
        ringHover: "hover:!ring-pink-500/70",
    },
    orange: {
        bg: "!bg-orange-400",
        ring: "!ring-orange-400/40",
        ringHover: "hover:!ring-orange-400/70",
    },
    green: {
        bg: "!bg-emerald-500",
        ring: "!ring-emerald-500/40",
        ringHover: "hover:!ring-emerald-500/70",
    },
    purple: {
        bg: "!bg-violet-500",
        ring: "!ring-violet-500/40",
        ringHover: "hover:!ring-violet-500/70",
    },
};
