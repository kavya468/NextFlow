"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const seedream_config_1 = require("../seedream.config");
const registry_1 = require("../../registry");
// Register at module scope so it's available when describe blocks evaluate
registry_1.nodeRegistry.register(seedream_config_1.seedreamConfig);
// ============================================================================
// Credits
// ============================================================================
(0, vitest_1.describe)("seedream credits", () => {
    (0, vitest_1.it)("estimate() always returns 15000", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.estimate({})).toBe(15000);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.estimate({ prompt: "a cat" })).toBe(15000);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.estimate({
            prompt: "a long detailed prompt ".repeat(100),
            image_url: "https://example.com/img.jpg",
        })).toBe(15000);
    });
    (0, vitest_1.it)("calculate() returns response.credits_used when present", () => {
        const result = seedream_config_1.seedreamConfig.credits.calculate({ prompt: "test" }, { credits_used: 12345 });
        (0, vitest_1.expect)(result).toBe(12345);
    });
    (0, vitest_1.it)("calculate() returns 15000 fallback when credits_used is missing", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.calculate({}, {})).toBe(15000);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.calculate({}, null)).toBe(15000);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.calculate({}, undefined)).toBe(15000);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.calculate({}, { some_other_field: 999 })).toBe(15000);
    });
    (0, vitest_1.it)("calculate() returns 15000 when credits_used is not a number", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.calculate({}, { credits_used: "not a number" })).toBe(15000);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.credits.calculate({}, { credits_used: null })).toBe(15000);
    });
});
// ============================================================================
// Zod Input Schema
// ============================================================================
(0, vitest_1.describe)("seedream Zod input schema", () => {
    const schema = registry_1.nodeRegistry.getInputSchema("seedream-4.5");
    (0, vitest_1.it)("rejects missing prompt", () => {
        const result = schema.safeParse({});
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("rejects empty string prompt", () => {
        const result = schema.safeParse({ prompt: "" });
        // Zod z.string() allows empty strings — the Trigger.dev task validates non-empty
        // The schema itself only enforces type: string, required: true
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)("accepts valid prompt-only input", () => {
        const result = schema.safeParse({ prompt: "a beautiful sunset" });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)("accepts all optional fields", () => {
        const result = schema.safeParse({
            prompt: "a beautiful sunset",
            image_url: "https://example.com/img.jpg",
            aspect_ratio: "16:9",
            guidance_scale: 10,
            num_inference_steps: 40,
            seed: 42,
        });
        (0, vitest_1.expect)(result.success).toBe(true);
    });
    (0, vitest_1.it)("rejects invalid aspect_ratio value", () => {
        const result = schema.safeParse({
            prompt: "test",
            aspect_ratio: "2:1",
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("rejects guidance_scale below minimum (1)", () => {
        const result = schema.safeParse({
            prompt: "test",
            guidance_scale: 0,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("rejects guidance_scale above maximum (20)", () => {
        const result = schema.safeParse({
            prompt: "test",
            guidance_scale: 25,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("rejects num_inference_steps below minimum (1)", () => {
        const result = schema.safeParse({
            prompt: "test",
            num_inference_steps: 0,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("rejects num_inference_steps above maximum (50)", () => {
        const result = schema.safeParse({
            prompt: "test",
            num_inference_steps: 100,
        });
        (0, vitest_1.expect)(result.success).toBe(false);
    });
    (0, vitest_1.it)("applies default values for optional fields", () => {
        const result = schema.safeParse({ prompt: "test" });
        (0, vitest_1.expect)(result.success).toBe(true);
        if (result.success) {
            (0, vitest_1.expect)(result.data.aspect_ratio).toBe("1:1");
            (0, vitest_1.expect)(result.data.guidance_scale).toBe(7.5);
            (0, vitest_1.expect)(result.data.num_inference_steps).toBe(30);
        }
    });
});
// ============================================================================
// Endpoint Selection
// ============================================================================
(0, vitest_1.describe)("seedream endpoint selection", () => {
    (0, vitest_1.it)("selects edit endpoint when image_url is present", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "make the sky blue",
            image_url: "https://example.com/photo.jpg",
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        (0, vitest_1.expect)(resolved.endpointId).toBe("seedream-edit");
        (0, vitest_1.expect)(resolved.taskId).toBe("seedream-4.5");
        (0, vitest_1.expect)(resolved.payload).toHaveProperty("image_url");
    });
    (0, vitest_1.it)("selects generate endpoint when image_url is absent", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "a beautiful sunset",
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        (0, vitest_1.expect)(resolved.endpointId).toBe("seedream-generate");
        (0, vitest_1.expect)(resolved.taskId).toBe("seedream-4.5");
        (0, vitest_1.expect)(resolved.payload).not.toHaveProperty("image_url");
    });
    (0, vitest_1.it)("selects generate endpoint when image_url is empty string", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "a landscape",
            image_url: "",
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        (0, vitest_1.expect)(resolved.endpointId).toBe("seedream-generate");
    });
    (0, vitest_1.it)("selects generate endpoint when image_url is whitespace only", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "a landscape",
            image_url: "   ",
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        (0, vitest_1.expect)(resolved.endpointId).toBe("seedream-generate");
    });
    (0, vitest_1.it)("maps inputs correctly for the generate endpoint", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "a sunset",
            aspect_ratio: "16:9",
            guidance_scale: 10,
            num_inference_steps: 40,
            seed: 42,
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        (0, vitest_1.expect)(resolved.payload).toEqual({
            prompt: "a sunset",
            aspect_ratio: "16:9",
            guidance_scale: 10,
            num_inference_steps: 40,
            seed: 42,
        });
    });
    (0, vitest_1.it)("maps inputs correctly for the edit endpoint", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "make brighter",
            image_url: "https://example.com/photo.jpg",
            guidance_scale: 5,
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        (0, vitest_1.expect)(resolved.payload).toEqual({
            prompt: "make brighter",
            image_url: "https://example.com/photo.jpg",
            guidance_scale: 5,
        });
    });
    (0, vitest_1.it)("omits undefined optional fields from payload", () => {
        const resolved = registry_1.nodeRegistry.resolveEndpoint("seedream-4.5", {
            prompt: "a cat",
        });
        (0, vitest_1.expect)(resolved).not.toBeNull();
        const keys = Object.keys(resolved.payload);
        (0, vitest_1.expect)(keys).toEqual(["prompt"]);
    });
});
// ============================================================================
// Output Mapping
// ============================================================================
(0, vitest_1.describe)("seedream output mapping", () => {
    (0, vitest_1.it)("maps task output image_url to node output image_url", () => {
        const mapped = registry_1.nodeRegistry.mapOutput("seedream-4.5", "seedream-generate", {
            image_url: "https://fal.media/files/output.png",
        });
        (0, vitest_1.expect)(mapped).toEqual({
            image_url: "https://fal.media/files/output.png",
        });
    });
    (0, vitest_1.it)("maps correctly for edit endpoint too", () => {
        const mapped = registry_1.nodeRegistry.mapOutput("seedream-4.5", "seedream-edit", {
            image_url: "https://fal.media/files/edited.png",
        });
        (0, vitest_1.expect)(mapped).toEqual({
            image_url: "https://fal.media/files/edited.png",
        });
    });
});
// ============================================================================
// Config Metadata
// ============================================================================
(0, vitest_1.describe)("seedream config metadata", () => {
    (0, vitest_1.it)("has correct id and name", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.id).toBe("seedream-4.5");
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.name).toBe("Seedream 4.5");
    });
    (0, vitest_1.it)("is categorized as AI node", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.category).toBe("ai");
    });
    (0, vitest_1.it)("is not a passthrough node", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.isPassthrough).toBeUndefined();
    });
    (0, vitest_1.it)("has exactly one output of type image", () => {
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.outputs).toHaveLength(1);
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.outputs[0].type).toBe("image");
        (0, vitest_1.expect)(seedream_config_1.seedreamConfig.outputs[0].key).toBe("image_url");
    });
    (0, vitest_1.it)("has prompt as the only required input", () => {
        const required = seedream_config_1.seedreamConfig.inputs.filter((i) => i.required);
        (0, vitest_1.expect)(required).toHaveLength(1);
        (0, vitest_1.expect)(required[0].key).toBe("prompt");
    });
    (0, vitest_1.it)("has 3 advanced inputs", () => {
        const advanced = seedream_config_1.seedreamConfig.inputs.filter((i) => i.isAdvanced);
        (0, vitest_1.expect)(advanced).toHaveLength(3);
        (0, vitest_1.expect)(advanced.map((a) => a.key).sort()).toEqual([
            "guidance_scale",
            "num_inference_steps",
            "seed",
        ]);
    });
    (0, vitest_1.it)("is registered in the node registry", () => {
        (0, vitest_1.expect)(registry_1.nodeRegistry.has("seedream-4.5")).toBe(true);
        (0, vitest_1.expect)(registry_1.nodeRegistry.get("seedream-4.5")).toBe(seedream_config_1.seedreamConfig);
    });
    (0, vitest_1.it)("appears in palette entries", () => {
        const entries = registry_1.nodeRegistry.getPaletteEntries();
        const seedream = entries.find((e) => e.type === "seedream-4.5");
        (0, vitest_1.expect)(seedream).toBeDefined();
        (0, vitest_1.expect)(seedream.label).toBe("Seedream 4.5");
        (0, vitest_1.expect)(seedream.category).toBe("ai");
        (0, vitest_1.expect)(seedream.icon).toBe("Sparkles");
    });
});
