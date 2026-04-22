"use strict";
// ============================================================================
// lib/nodes/registry.ts — The Central Node Registry (Single Source of Truth)
// ============================================================================
//
// The NodeRegistry is the brain of the Config-Driven Node System.
// It stores all NodeConfig objects and provides methods to:
//   1. Auto-generate Zod input/output schemas from config definitions
//   2. Resolve which provider endpoint to use for a given node + inputs
//   3. Supply sidebar palette entries for the LeftSidebar
//   4. Supply connection validation rules for React Flow
//   5. Supply passthrough resolution for input→output nodes
//
// USAGE:
//   import { nodeRegistry } from '@/lib/nodes/registry';
//   // In orchestrator: nodeRegistry.resolveEndpoint("crop", inputs)
//   // In sidebar:      nodeRegistry.getPaletteEntries()
//   // In validation:   nodeRegistry.getInputSchema("crop")
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.nodeRegistry = void 0;
const zod_1 = require("zod");
// Zod type factory — converts an IOType + InputDefinition into a ZodType
function buildZodField(input) {
    let field;
    switch (input.type) {
        case "text":
        case "image":
        case "video":
        case "audio":
        case "file": {
            if (input.uiVariant === "elements-editor" || input.uiVariant === "dialogue-editor") {
                field = zod_1.z.any();
                break;
            }
            let strField = zod_1.z.string();
            if (input.validation?.maxLength) {
                strField = strField.max(input.validation.maxLength);
            }
            field = strField;
            break;
        }
        case "number": {
            let numField = zod_1.z.coerce.number({ message: `${input.label} must be a valid number` });
            if (input.validation?.min !== undefined) {
                numField = numField.min(input.validation.min, { message: `${input.label} must be at least ${input.validation.min}` });
            }
            if (input.validation?.max !== undefined) {
                numField = numField.max(input.validation.max, { message: `${input.label} must be at most ${input.validation.max}` });
            }
            field = numField;
            break;
        }
        case "boolean": {
            field = zod_1.z.coerce.boolean();
            break;
        }
        case "select": {
            const options = input.validation?.options;
            if (options && options.length > 0) {
                const values = options.map((o) => o.value);
                field = zod_1.z.enum(values);
            }
            else {
                field = zod_1.z.string();
            }
            break;
        }
        default:
            field = zod_1.z.any();
    }
    // Handle multi-value inputs (e.g., "images" array)
    if (input.multi) {
        field = zod_1.z.array(field);
    }
    // Make optional with default, or required
    if (!input.required) {
        if (input.default !== undefined) {
            field = field.optional().default(input.default);
        }
        else {
            field = field.optional();
        }
    }
    return field;
}
function buildZodOutputField(output) {
    switch (output.type) {
        case "text":
        case "image":
        case "video":
        case "audio":
        case "file":
            return zod_1.z.string().optional();
        case "number":
            return zod_1.z.number().optional();
        case "boolean":
            return zod_1.z.boolean().optional();
        default:
            return zod_1.z.any().optional();
    }
}
// NodeRegistry Class
class NodeRegistry {
    configs = new Map();
    inputSchemaCache = new Map();
    outputSchemaCache = new Map();
    // Registration
    /**
     * Register a node config. Called once per config file at import time.
     * Invalidates cached schemas if re-registering.
     */
    register(config) {
        this.configs.set(config.id, config);
        // Invalidate caches on re-register
        this.inputSchemaCache.delete(config.id);
        this.outputSchemaCache.delete(config.id);
    }
    /**
     * Bulk registration from an array of configs.
     */
    registerAll(configs) {
        for (const config of configs) {
            this.register(config);
        }
    }
    // Getters
    /** Get a single config by node type ID */
    get(id) {
        return this.configs.get(id);
    }
    /** Get all registered configs */
    getAll() {
        return Array.from(this.configs.values());
    }
    /** Check if a node type is registered */
    has(id) {
        return this.configs.has(id);
    }
    /** Get all registered node type IDs */
    getTypes() {
        return Array.from(this.configs.keys());
    }
    // Zod Schema Generation — dynamically builds schemas from config inputs
    /**
     * Generate a Zod input schema for a node type.
     * Cached after first generation for performance.
     */
    getInputSchema(id) {
        const cached = this.inputSchemaCache.get(id);
        if (cached)
            return cached;
        const config = this.configs.get(id);
        if (!config) {
            throw new Error(`[NodeRegistry] Unknown node type: "${id}"`);
        }
        const shape = {};
        for (const input of config.inputs) {
            shape[input.key] = buildZodField(input);
        }
        // Use .passthrough() for nodes with dynamic handles (e.g., DialogueEditor)
        // so that dynamic keys like `dialogue_text_0` survive Zod validation.
        const schema = config.allowDynamicHandles
            ? zod_1.z.object(shape).passthrough()
            : zod_1.z.object(shape);
        this.inputSchemaCache.set(id, schema);
        return schema;
    }
    /**
     * Generate a Zod output schema for a node type.
     * Cached after first generation.
     */
    getOutputSchema(id) {
        const cached = this.outputSchemaCache.get(id);
        if (cached)
            return cached;
        const config = this.configs.get(id);
        if (!config) {
            throw new Error(`[NodeRegistry] Unknown node type: "${id}"`);
        }
        const shape = {};
        for (const output of config.outputs) {
            shape[output.key] = buildZodOutputField(output);
        }
        const schema = zod_1.z.object(shape);
        this.outputSchemaCache.set(id, schema);
        return schema;
    }
    // Endpoint Resolution — determines which task to dispatch for given inputs
    /**
     * Resolve the correct provider endpoint for a node type given its inputs.
     * Walks the provider fallback chain, applying endpoint conditions.
     * Returns the task ID and mapped payload ready for Trigger.dev dispatch.
     */
    resolveEndpoint(nodeType, inputs) {
        const config = this.configs.get(nodeType);
        if (!config)
            return null;
        // For passthrough nodes, there's no task to dispatch
        if (config.isPassthrough)
            return null;
        // Walk providers in order (fallback chain)
        for (const provider of config.providers) {
            for (const endpoint of provider.endpoints) {
                // Check condition if present
                if (endpoint.condition && !endpoint.condition(inputs)) {
                    continue;
                }
                // Build the payload using inputMapping
                const payload = {};
                if (endpoint.inputMapping) {
                    for (const [inputKey, payloadKey] of Object.entries(endpoint.inputMapping)) {
                        if (inputs[inputKey] !== undefined) {
                            payload[payloadKey] = inputs[inputKey];
                        }
                    }
                }
                else {
                    // Pass-through: use input keys directly
                    Object.assign(payload, inputs);
                }
                return {
                    taskId: endpoint.taskId,
                    payload,
                    providerId: provider.id,
                    endpointId: endpoint.id,
                };
            }
        }
        return null;
    }
    /**
     * Map raw task output back to node output keys using outputMapping.
     */
    mapOutput(nodeType, endpointId, rawOutput) {
        const config = this.configs.get(nodeType);
        if (!config)
            return rawOutput;
        // Find the endpoint that was used
        for (const provider of config.providers) {
            for (const endpoint of provider.endpoints) {
                if (endpoint.id === endpointId && endpoint.outputMapping) {
                    const mapped = {};
                    for (const [taskKey, nodeKey] of Object.entries(endpoint.outputMapping)) {
                        mapped[nodeKey] = rawOutput[taskKey];
                    }
                    return mapped;
                }
            }
        }
        return rawOutput;
    }
    // Passthrough Resolution — for input nodes (Text, Image, Video)
    /**
     * Resolve passthrough outputs from inputs.
     * Used by the orchestrator to immediately resolve input-only nodes.
     */
    resolvePassthrough(nodeType, inputs) {
        const config = this.configs.get(nodeType);
        if (!config || !config.isPassthrough || !config.passthroughMapping) {
            return null;
        }
        const output = {};
        for (const [inputKey, outputKey] of Object.entries(config.passthroughMapping)) {
            output[outputKey] = inputs[inputKey] ?? "";
        }
        return output;
    }
    // Sidebar Palette — generates entries for the LeftSidebar component
    /**
     * Get palette entries grouped by category for the sidebar.
     */
    getPaletteEntries() {
        return this.getAll().map((config) => ({
            type: config.id,
            label: config.name,
            description: config.description,
            category: config.category,
            icon: config.icon,
        }));
    }
    /**
     * Get palette entries grouped by category.
     */
    getPaletteByCategory() {
        const groups = {};
        for (const entry of this.getPaletteEntries()) {
            if (!groups[entry.category]) {
                groups[entry.category] = [];
            }
            groups[entry.category].push(entry);
        }
        return groups;
    }
    // Connection Validation — for React Flow isValidConnection
    /**
     * Check if a connection between two handles is type-compatible.
     * Returns true if the source output type can flow into the target input type.
     */
    isValidConnection(sourceNodeType, sourceHandleId, targetNodeType, targetHandleId) {
        const sourceConfig = this.configs.get(sourceNodeType);
        const targetConfig = this.configs.get(targetNodeType);
        if (!sourceConfig || !targetConfig)
            return false;
        const sourceOutput = sourceConfig.outputs.find((o) => o.key === sourceHandleId);
        const targetInput = targetConfig.inputs.find((i) => i.key === targetHandleId);
        if (!sourceOutput || !targetInput)
            return false;
        // Type compatibility matrix
        return isTypeCompatible(sourceOutput.type, targetInput.type);
    }
    // Credit Estimation — pre-execution cost display
    /**
     * Estimate credit cost for a node execution.
     */
    estimateCredits(nodeType, inputs) {
        const config = this.configs.get(nodeType);
        if (!config)
            return 0;
        return config.credits.estimate(inputs);
    }
    /**
     * Calculate actual credit cost after execution.
     */
    calculateCredits(nodeType, inputs, response) {
        const config = this.configs.get(nodeType);
        if (!config)
            return 0;
        return config.credits.calculate(inputs, response);
    }
}
// Type compatibility check — determines if data can flow between handles
function isTypeCompatible(sourceType, targetType) {
    if (sourceType === targetType)
        return true;
    // Text is the universal wire — it can flow into any target type.
    // Coercion (z.coerce.number/boolean) + pre-flight validation handle safety.
    if (sourceType === "text")
        return true;
    // Image/video/audio URLs can flow into text inputs
    if (["image", "video", "audio", "file"].includes(sourceType) && targetType === "text") {
        return true;
    }
    // Media types are cross-compatible (they're all URLs)
    if (["image", "video", "audio", "file"].includes(sourceType) &&
        ["image", "video", "audio", "file"].includes(targetType)) {
        return true;
    }
    return false;
}
// Singleton Export — the single source of truth for the entire application
exports.nodeRegistry = new NodeRegistry();
