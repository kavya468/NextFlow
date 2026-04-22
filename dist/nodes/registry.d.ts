import { ZodObject, ZodTypeAny } from "zod";
import type { NodeConfig } from "./types";
type MutableShape = Record<string, ZodTypeAny>;
export interface ResolvedEndpoint {
    taskId: string;
    payload: Record<string, unknown>;
    providerId: string;
    endpointId: string;
}
export interface PaletteEntry {
    type: string;
    label: string;
    description: string;
    category: string;
    icon: string;
}
declare class NodeRegistry {
    private configs;
    private inputSchemaCache;
    private outputSchemaCache;
    /**
     * Register a node config. Called once per config file at import time.
     * Invalidates cached schemas if re-registering.
     */
    register(config: NodeConfig): void;
    /**
     * Bulk registration from an array of configs.
     */
    registerAll(configs: NodeConfig[]): void;
    /** Get a single config by node type ID */
    get(id: string): NodeConfig | undefined;
    /** Get all registered configs */
    getAll(): NodeConfig[];
    /** Check if a node type is registered */
    has(id: string): boolean;
    /** Get all registered node type IDs */
    getTypes(): string[];
    /**
     * Generate a Zod input schema for a node type.
     * Cached after first generation for performance.
     */
    getInputSchema(id: string): ZodObject<MutableShape>;
    /**
     * Generate a Zod output schema for a node type.
     * Cached after first generation.
     */
    getOutputSchema(id: string): ZodObject<MutableShape>;
    /**
     * Resolve the correct provider endpoint for a node type given its inputs.
     * Walks the provider fallback chain, applying endpoint conditions.
     * Returns the task ID and mapped payload ready for Trigger.dev dispatch.
     */
    resolveEndpoint(nodeType: string, inputs: Record<string, unknown>): ResolvedEndpoint | null;
    /**
     * Map raw task output back to node output keys using outputMapping.
     */
    mapOutput(nodeType: string, endpointId: string, rawOutput: Record<string, unknown>): Record<string, unknown>;
    /**
     * Resolve passthrough outputs from inputs.
     * Used by the orchestrator to immediately resolve input-only nodes.
     */
    resolvePassthrough(nodeType: string, inputs: Record<string, unknown>): Record<string, unknown> | null;
    /**
     * Get palette entries grouped by category for the sidebar.
     */
    getPaletteEntries(): PaletteEntry[];
    /**
     * Get palette entries grouped by category.
     */
    getPaletteByCategory(): Record<string, PaletteEntry[]>;
    /**
     * Check if a connection between two handles is type-compatible.
     * Returns true if the source output type can flow into the target input type.
     */
    isValidConnection(sourceNodeType: string, sourceHandleId: string, targetNodeType: string, targetHandleId: string): boolean;
    /**
     * Estimate credit cost for a node execution.
     */
    estimateCredits(nodeType: string, inputs: Record<string, unknown>): number;
    /**
     * Calculate actual credit cost after execution.
     */
    calculateCredits(nodeType: string, inputs: Record<string, unknown>, response: unknown): number;
}
export declare const nodeRegistry: NodeRegistry;
export {};
