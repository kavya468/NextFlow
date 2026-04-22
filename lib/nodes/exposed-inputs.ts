// ============================================================================
// lib/nodes/exposed-inputs.ts — Exposed Input Discovery for Parameterized Execution
// ============================================================================
//
// Provides the ExposedInput interface and getExposedInputs() utility that
// scans a workflow's node array and surfaces all overridable parameters.
//
// TWO MODES OF EXPOSURE:
//   1. AUTO (passthrough): All passthrough nodes (text, image, video) are
//      automatically exposed via their passthroughMapping keys.
//   2. EXPLICIT (any node): Any node can opt-in by setting
//      node.data.exposedInputKeys = ["prompt", "model", ...] — an array
//      of input keys (matching InputDefinition.key) to surface.
//
// RESOLUTION KEY: node.data.label (NOT nodeId)
// This ensures stability across workflow copies and node rearrangements.
// If a label is not set, falls back to the node type name (e.g., "text").
//
// For explicit exposure, a compound label is used:
//   "{nodeLabel}.{inputKey}" — e.g. "My LLM.system_prompt"
// This prevents collisions when multiple nodes expose the same key name.
// ============================================================================

import type { NodeConfig } from "./types";

// ---------------------------------------------------------------------------
// ExposedInput — describes a single overridable parameter in a workflow
// ---------------------------------------------------------------------------
export interface ExposedInput {
  /** Resolution key for overrides — label for passthrough, label.key for explicit */
  label: string;
  /** Node type identifier (e.g., "text", "image", "llm") */
  nodeType: string;
  /** The data key that holds the overridable value (e.g., "text", "prompt") */
  dataKey: string;
  /** Current default value from the workflow template */
  defaultValue: unknown;
  /** Description of what this input does */
  description: string;
  /** The node's instance ID — used by the orchestrator for targeted overrides */
  nodeId: string;
  /** The type of input control to render */
  inputType?: "text" | "textarea" | "number" | "boolean" | "select" | "url" | string;
  /** Options for select inputs */
  options?: Array<{ label: string; value: string }>;
  /** Minimum value for number inputs */
  min?: number;
  /** Maximum value for number inputs */
  max?: number;
}

// ---------------------------------------------------------------------------
// Registry-compatible interface — avoids importing the full NodeRegistry
// class, allowing this module to be used in MCP (ESM) and tRPC contexts.
// ---------------------------------------------------------------------------
export interface RegistryLike {
  get(id: string): Pick<NodeConfig, "isPassthrough" | "passthroughMapping" | "description" | "inputs"> | undefined;
}

// ---------------------------------------------------------------------------
// ExposedInputsResult — return type for getExposedInputs
// ---------------------------------------------------------------------------
export interface ExposedInputsResult {
  /** All overridable input descriptors. */
  inputs: ExposedInput[];
  /** Human-readable warnings (e.g. duplicate labels that cause data corruption). */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// getExposedInputs — extract all parameterizable inputs from a workflow
// ---------------------------------------------------------------------------
/**
 * Scans the workflow's node array and extracts overridable inputs:
 *   1. Passthrough nodes → auto-exposed via passthroughMapping
 *   2. Any node with data.exposedInputKeys → explicitly exposed fields
 *
 * Also detects duplicate resolution labels among passthrough nodes and
 * returns them as warnings — duplicate labels cause the orchestrator's
 * Step 0 to apply a single override to ALL matching nodes silently.
 *
 * @param nodes  - The workflow's deserialized nodes array (from Workflow.nodes)
 * @param registry - A registry-like object that can look up NodeConfig by type
 * @returns Object with `inputs` (ExposedInput[]) and `warnings` (string[])
 */
export function getExposedInputs(
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>,
  registry: RegistryLike,
): ExposedInputsResult {
  const exposed: ExposedInput[] = [];
  const warnings: string[] = [];

  // Track passthrough labels → nodeIds for duplicate detection
  const passthroughLabelMap = new Map<string, string[]>();

  for (const node of nodes) {
    if (!node.type) continue;

    const config = registry.get(node.type);
    if (!config) continue;

    const nodeLabel = (node.data.label as string) || node.type;

    // ── Mode 1: Passthrough auto-expose ──────────────────────────────
    if (config.isPassthrough && config.passthroughMapping) {
      // Track this label for duplicate detection
      if (!passthroughLabelMap.has(nodeLabel)) {
        passthroughLabelMap.set(nodeLabel, []);
      }
      passthroughLabelMap.get(nodeLabel)!.push(node.id);

      for (const dataKey of Object.keys(config.passthroughMapping)) {
        const inputDef = config.inputs?.find((inp: any) => inp.key === dataKey);
        
        exposed.push({
          label: nodeLabel,
          nodeType: node.type,
          dataKey,
          defaultValue: node.data[dataKey] ?? "",
          description: config.description,
          nodeId: node.id,
          inputType: inputDef?.type as any,
          options: inputDef?.validation?.options,
          min: inputDef?.validation?.min,
          max: inputDef?.validation?.max,
        });
      }
    }

    // ── Mode 2: Explicit per-input-key expose ────────────────────────
    const exposedKeys = node.data.exposedInputKeys;
    if (Array.isArray(exposedKeys) && exposedKeys.length > 0) {
      for (const inputKey of exposedKeys) {
        if (typeof inputKey !== "string") continue;

        // Skip keys already covered by passthrough auto-expose
        if (config.isPassthrough && config.passthroughMapping && inputKey in config.passthroughMapping) {
          continue;
        }

        // Look up the InputDefinition for this key
        const inputDef = config.inputs?.find((inp: any) => inp.key === inputKey);
        const description = inputDef?.description || config.description;

        exposed.push({
          label: `${nodeLabel}.${inputKey}`,
          nodeType: node.type,
          dataKey: inputKey,
          defaultValue: node.data[inputKey] ?? inputDef?.default ?? "",
          description,
          nodeId: node.id,
          inputType: inputDef?.type as any,
          options: inputDef?.validation?.options,
          min: inputDef?.validation?.min,
          max: inputDef?.validation?.max,
        });
      }
    }
  }

  // ── Duplicate label detection ────────────────────────────────────────
  for (const [label, nodeIds] of passthroughLabelMap) {
    if (nodeIds.length > 1) {
      warnings.push(
        `Label "${label}" resolves to ${nodeIds.length} passthrough nodes ` +
        `(${nodeIds.join(", ")}). Input overrides will be applied to ALL of them, ` +
        `causing silent data corruption. Assign unique labels to each node.`
      );
    }
  }

  return { inputs: exposed, warnings };
}

// ---------------------------------------------------------------------------
// deduplicatePassthroughLabels — auto-suffix duplicate labels in a nodes array
// ---------------------------------------------------------------------------
/**
 * Scans a mutable nodes array and ensures every passthrough node has a unique
 * resolution label (node.data.label || node.type). If duplicates are found,
 * suffixes them with sequential numbers: "Text", "Text 2", "Text 3", etc.
 *
 * Mutates `nodes` in-place and returns the list of labels that were changed.
 *
 * @returns Array of { nodeId, oldLabel, newLabel } for each relabeled node.
 */
export function deduplicatePassthroughLabels(
  nodes: Array<{ id: string; type?: string; data: Record<string, unknown> }>,
  registry: RegistryLike,
): Array<{ nodeId: string; oldLabel: string; newLabel: string }> {
  const changes: Array<{ nodeId: string; oldLabel: string; newLabel: string }> = [];

  // Collect all passthrough nodes grouped by their resolved label
  const labelGroups = new Map<string, Array<{ node: typeof nodes[0]; index: number }>>();

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node.type) continue;

    const config = registry.get(node.type);
    if (!config?.isPassthrough) continue;

    const resolvedLabel = (node.data.label as string) || node.type;
    if (!labelGroups.has(resolvedLabel)) {
      labelGroups.set(resolvedLabel, []);
    }
    labelGroups.get(resolvedLabel)!.push({ node, index: i });
  }

  // For each group with duplicates, assign unique suffixed labels
  for (const [baseLabel, group] of labelGroups) {
    if (group.length <= 1) continue;

    // Collect all existing labels in the workflow to avoid further collisions
    const existingLabels = new Set<string>();
    for (const n of nodes) {
      const l = (n.data.label as string) || n.type || "";
      if (l) existingLabels.add(l);
    }

    for (let i = 0; i < group.length; i++) {
      const { node } = group[i];
      // First node gets "Label 1", second "Label 2", etc.
      let suffix = i + 1;
      let candidate = `${baseLabel} ${suffix}`;
      while (existingLabels.has(candidate)) {
        suffix++;
        candidate = `${baseLabel} ${suffix}`;
      }
      existingLabels.add(candidate);

      const oldLabel = (node.data.label as string) || node.type || baseLabel;
      node.data.label = candidate;
      changes.push({ nodeId: node.id, oldLabel, newLabel: candidate });
    }
  }

  return changes;
}

