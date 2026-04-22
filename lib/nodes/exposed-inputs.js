"use strict";
// ============================================================================
// lib/nodes/exposed-inputs.js — Compiled from exposed-inputs.ts
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.getExposedInputs = getExposedInputs;
/**
 * Scans the workflow's node array and extracts overridable inputs:
 *   1. Passthrough nodes → auto-exposed via passthroughMapping
 *   2. Any node with data.exposedInputKeys → explicitly exposed fields
 */
function getExposedInputs(nodes, registry) {
    const exposed = [];
    for (const node of nodes) {
        if (!node.type)
            continue;
        const config = registry.get(node.type);
        if (!config)
            continue;
        const nodeLabel = node.data.label || node.type;
        // Mode 1: Passthrough auto-expose
        if (config.isPassthrough && config.passthroughMapping) {
            for (const dataKey of Object.keys(config.passthroughMapping)) {
                exposed.push({
                    label: nodeLabel,
                    nodeType: node.type,
                    dataKey,
                    defaultValue: node.data[dataKey] ?? "",
                    description: config.description,
                    nodeId: node.id,
                });
            }
        }
        // Mode 2: Explicit per-input-key expose
        const exposedKeys = node.data.exposedInputKeys;
        if (Array.isArray(exposedKeys) && exposedKeys.length > 0) {
            for (const inputKey of exposedKeys) {
                if (typeof inputKey !== "string")
                    continue;
                // Skip keys already covered by passthrough auto-expose
                if (config.isPassthrough && config.passthroughMapping && inputKey in config.passthroughMapping) {
                    continue;
                }
                // Look up the InputDefinition for this key
                const inputDef = config.inputs?.find((inp) => inp.key === inputKey);
                const description = inputDef?.description || config.description;
                exposed.push({
                    label: `${nodeLabel}.${inputKey}`,
                    nodeType: node.type,
                    dataKey: inputKey,
                    defaultValue: node.data[inputKey] ?? inputDef?.default ?? "",
                    description,
                    nodeId: node.id,
                });
            }
        }
    }
    return exposed;
}
