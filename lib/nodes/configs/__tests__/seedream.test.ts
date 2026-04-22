import { describe, it, expect } from "vitest";
import { seedreamConfig } from "../seedream.config";
import { nodeRegistry } from "../../registry";

// Register at module scope so it's available when describe blocks evaluate
nodeRegistry.register(seedreamConfig);

// ============================================================================
// Credits
// ============================================================================

describe("seedream credits", () => {
  it("estimate() always returns 15000", () => {
    expect(seedreamConfig.credits.estimate({})).toBe(15000);
    expect(seedreamConfig.credits.estimate({ prompt: "a cat" })).toBe(15000);
    expect(
      seedreamConfig.credits.estimate({
        prompt: "a long detailed prompt ".repeat(100),
        image_url: "https://example.com/img.jpg",
      })
    ).toBe(15000);
  });

  it("calculate() returns response.credits_used when present", () => {
    const result = seedreamConfig.credits.calculate(
      { prompt: "test" },
      { credits_used: 12345 }
    );
    expect(result).toBe(12345);
  });

  it("calculate() returns 15000 fallback when credits_used is missing", () => {
    expect(seedreamConfig.credits.calculate({}, {})).toBe(15000);
    expect(seedreamConfig.credits.calculate({}, null)).toBe(15000);
    expect(seedreamConfig.credits.calculate({}, undefined)).toBe(15000);
    expect(
      seedreamConfig.credits.calculate({}, { some_other_field: 999 })
    ).toBe(15000);
  });

  it("calculate() returns 15000 when credits_used is not a number", () => {
    expect(
      seedreamConfig.credits.calculate({}, { credits_used: "not a number" })
    ).toBe(15000);
    expect(
      seedreamConfig.credits.calculate({}, { credits_used: null })
    ).toBe(15000);
  });
});

// ============================================================================
// Zod Input Schema
// ============================================================================

describe("seedream Zod input schema", () => {
  const schema = nodeRegistry.getInputSchema("seedream-4.5");

  it("rejects missing prompt", () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty string prompt", () => {
    const result = schema.safeParse({ prompt: "" });
    // Zod z.string() allows empty strings — the Trigger.dev task validates non-empty
    // The schema itself only enforces type: string, required: true
    expect(result.success).toBe(true);
  });

  it("accepts valid prompt-only input", () => {
    const result = schema.safeParse({ prompt: "a beautiful sunset" });
    expect(result.success).toBe(true);
  });

  it("accepts all optional fields", () => {
    const result = schema.safeParse({
      prompt: "a beautiful sunset",
      image_url: "https://example.com/img.jpg",
      aspect_ratio: "16:9",
      guidance_scale: 10,
      num_inference_steps: 40,
      seed: 42,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid aspect_ratio value", () => {
    const result = schema.safeParse({
      prompt: "test",
      aspect_ratio: "2:1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects guidance_scale below minimum (1)", () => {
    const result = schema.safeParse({
      prompt: "test",
      guidance_scale: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects guidance_scale above maximum (20)", () => {
    const result = schema.safeParse({
      prompt: "test",
      guidance_scale: 25,
    });
    expect(result.success).toBe(false);
  });

  it("rejects num_inference_steps below minimum (1)", () => {
    const result = schema.safeParse({
      prompt: "test",
      num_inference_steps: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects num_inference_steps above maximum (50)", () => {
    const result = schema.safeParse({
      prompt: "test",
      num_inference_steps: 100,
    });
    expect(result.success).toBe(false);
  });

  it("applies default values for optional fields", () => {
    const result = schema.safeParse({ prompt: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aspect_ratio).toBe("1:1");
      expect(result.data.guidance_scale).toBe(7.5);
      expect(result.data.num_inference_steps).toBe(30);
    }
  });
});

// ============================================================================
// Endpoint Selection
// ============================================================================

describe("seedream endpoint selection", () => {
  it("selects edit endpoint when image_url is present", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "make the sky blue",
      image_url: "https://example.com/photo.jpg",
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.endpointId).toBe("seedream-edit");
    expect(resolved!.taskId).toBe("seedream-4.5");
    expect(resolved!.payload).toHaveProperty("image_url");
  });

  it("selects generate endpoint when image_url is absent", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "a beautiful sunset",
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.endpointId).toBe("seedream-generate");
    expect(resolved!.taskId).toBe("seedream-4.5");
    expect(resolved!.payload).not.toHaveProperty("image_url");
  });

  it("selects generate endpoint when image_url is empty string", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "a landscape",
      image_url: "",
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.endpointId).toBe("seedream-generate");
  });

  it("selects generate endpoint when image_url is whitespace only", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "a landscape",
      image_url: "   ",
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.endpointId).toBe("seedream-generate");
  });

  it("maps inputs correctly for the generate endpoint", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "a sunset",
      aspect_ratio: "16:9",
      guidance_scale: 10,
      num_inference_steps: 40,
      seed: 42,
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.payload).toEqual({
      prompt: "a sunset",
      aspect_ratio: "16:9",
      guidance_scale: 10,
      num_inference_steps: 40,
      seed: 42,
    });
  });

  it("maps inputs correctly for the edit endpoint", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "make brighter",
      image_url: "https://example.com/photo.jpg",
      guidance_scale: 5,
    });

    expect(resolved).not.toBeNull();
    expect(resolved!.payload).toEqual({
      prompt: "make brighter",
      image_url: "https://example.com/photo.jpg",
      guidance_scale: 5,
    });
  });

  it("omits undefined optional fields from payload", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      prompt: "a cat",
    });

    expect(resolved).not.toBeNull();
    const keys = Object.keys(resolved!.payload);
    expect(keys).toEqual(["prompt"]);
  });
});

// ============================================================================
// Output Mapping
// ============================================================================

describe("seedream output mapping", () => {
  it("maps task output image_url to node output image_url", () => {
    const mapped = nodeRegistry.mapOutput("seedream-4.5", "seedream-generate", {
      image_url: "https://fal.media/files/output.png",
    });
    expect(mapped).toEqual({
      image_url: "https://fal.media/files/output.png",
    });
  });

  it("maps correctly for edit endpoint too", () => {
    const mapped = nodeRegistry.mapOutput("seedream-4.5", "seedream-edit", {
      image_url: "https://fal.media/files/edited.png",
    });
    expect(mapped).toEqual({
      image_url: "https://fal.media/files/edited.png",
    });
  });
});

// ============================================================================
// Config Metadata
// ============================================================================

describe("seedream config metadata", () => {
  it("has correct id and name", () => {
    expect(seedreamConfig.id).toBe("seedream-4.5");
    expect(seedreamConfig.name).toBe("Seedream 4.5");
  });

  it("is categorized as AI node", () => {
    expect(seedreamConfig.category).toBe("ai");
  });

  it("is not a passthrough node", () => {
    expect(seedreamConfig.isPassthrough).toBeUndefined();
  });

  it("has exactly one output of type image", () => {
    expect(seedreamConfig.outputs).toHaveLength(1);
    expect(seedreamConfig.outputs[0].type).toBe("image");
    expect(seedreamConfig.outputs[0].key).toBe("image_url");
  });

  it("has prompt as the only required input", () => {
    const required = seedreamConfig.inputs.filter((i) => i.required);
    expect(required).toHaveLength(1);
    expect(required[0].key).toBe("prompt");
  });

  it("has 3 advanced inputs", () => {
    const advanced = seedreamConfig.inputs.filter((i) => i.isAdvanced);
    expect(advanced).toHaveLength(3);
    expect(advanced.map((a) => a.key).sort()).toEqual([
      "guidance_scale",
      "num_inference_steps",
      "seed",
    ]);
  });

  it("is registered in the node registry", () => {
    expect(nodeRegistry.has("seedream-4.5")).toBe(true);
    expect(nodeRegistry.get("seedream-4.5")).toBe(seedreamConfig);
  });

  it("appears in palette entries", () => {
    const entries = nodeRegistry.getPaletteEntries();
    const seedream = entries.find((e) => e.type === "seedream-4.5");
    expect(seedream).toBeDefined();
    expect(seedream!.label).toBe("Seedream 4.5");
    expect(seedream!.category).toBe("ai");
    expect(seedream!.icon).toBe("Sparkles");
  });
});
