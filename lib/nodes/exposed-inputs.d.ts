import type { NodeConfig } from "./types";
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
}
export interface RegistryLike {
    get(id: string): Pick<NodeConfig, "isPassthrough" | "passthroughMapping" | "description" | "inputs"> | undefined;
}
/**
 * Scans the workflow's node array and extracts overridable inputs:
 *   1. Passthrough nodes → auto-exposed via passthroughMapping
 *   2. Any node with data.exposedInputKeys → explicitly exposed fields
 *
 * @param nodes  - The workflow's deserialized nodes array (from Workflow.nodes)
 * @param registry - A registry-like object that can look up NodeConfig by type
 * @returns Array of ExposedInput descriptors
 */
export declare function getExposedInputs(nodes: Array<{
    id: string;
    type?: string;
    data: Record<string, unknown>;
}>, registry: RegistryLike): ExposedInput[];
