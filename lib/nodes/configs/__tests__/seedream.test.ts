import { describe, it, expect } from "vitest";
import { seedreamConfig } from "../seedream.config";
import { nodeRegistry } from "../../registry";

nodeRegistry.register(seedreamConfig);

// The node now selects an explicit mode and dispatches one Seedream task.
// These tests exercise its public registry contract without calling fal.ai.
describe("seedream credits", () => {
  it("reserves the maximum 36 generated images even when controls arrive upstream", () => {
    expect(seedreamConfig.credits.estimate({})).toBe(1_440_000);
    expect(seedreamConfig.credits.estimate({ mode: "generate", prompt: "a cat" })).toBe(1_440_000);
    expect(seedreamConfig.credits.estimate({ mode: "edit", prompt: "a cat", num_images: 6, max_images: 6 })).toBe(1_440_000);
  });

  it("converts response cost to microcredits and rounds upward", () => {
    expect(seedreamConfig.credits.calculate({}, { cost: 0.0123454 })).toBe(12_346);
    expect(seedreamConfig.credits.calculate({}, { cost: 0 })).toBe(0);
  });

  it.each([{}, null, undefined, { cost: "0.01" }, { cost: null }, { credits_used: 12345 }])(
    "rejects absent usage instead of inventing a fixed image charge: %j",
    (response) => {
      expect(() => seedreamConfig.credits.calculate({}, response)).toThrow("generated image count");
    },
  );

  it("charges the returned image count rather than every requested maximum", () => {
    expect(seedreamConfig.credits.calculate({ num_images: 6, max_images: 6 }, { generatedImageCount: 2 })).toBe(80_000);
  });
});

describe("seedream registry input schema", () => {
  const schema = nodeRegistry.getInputSchema("seedream-4.5");
  const valid = { mode: "generate", prompt: "a beautiful sunset" };

  it("requires both an explicit mode and a string prompt", () => {
    expect(schema.safeParse({ mode: "generate" }).success).toBe(false);
    expect(schema.safeParse({ prompt: "a sunset" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, prompt: 123 }).success).toBe(false);
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it("allows empty draft text at the registry layer", () => {
    // The task's input schema owns non-empty prompt validation before generation.
    expect(schema.safeParse({ ...valid, prompt: "" }).success).toBe(true);
  });

  it("rejects unsupported modes and image-size presets", () => {
    expect(schema.safeParse({ ...valid, mode: "inpaint" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, image_size: "16:9" }).success).toBe(false);
  });

  it("accepts the current optional fields", () => {
    const input = {
      mode: "edit",
      prompt: "make the sky blue",
      image_urls: "https://example.com/image.jpg",
      image_size: "landscape_16_9",
      num_images: 2,
      max_images: 3,
      enable_safety_checker: false,
      seed: 42,
    };
    expect(schema.parse(input)).toEqual({ ...input, image_urls: [input.image_urls] });
  });

  it.each(["num_images", "max_images"])("enforces the 1–6 range for %s", (field) => {
    expect(schema.safeParse({ ...valid, [field]: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, [field]: 7 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, [field]: 1 }).success).toBe(true);
    expect(schema.safeParse({ ...valid, [field]: 6 }).success).toBe(true);
  });

  it("enforces the seed range and preserves seed zero", () => {
    expect(schema.safeParse({ ...valid, seed: -1 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, seed: 2_147_483_648 }).success).toBe(false);
    expect(schema.parse({ ...valid, seed: 0 }).seed).toBe(0);
  });

  it("applies generation defaults without overriding the provider image size", () => {
    expect(schema.parse(valid)).toEqual({
      ...valid,
      num_images: 1,
      max_images: 1,
      enable_safety_checker: true,
    });
  });
});

describe("seedream dispatch mapping", () => {
  it.each(["generate", "edit"])("dispatches %s through the shared task with its mode", (mode) => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      mode,
      prompt: "a sunset",
    });
    expect(resolved).toMatchObject({
      providerId: "fal",
      endpointId: "seedream",
      taskId: "seedream-4.5",
      payload: { mode, prompt: "a sunset" },
    });
  });

  it("forwards current generation options including false and zero values", () => {
    const input = {
      mode: "generate",
      prompt: "a sunset",
      image_size: "landscape_16_9",
      num_images: 2,
      max_images: 3,
      enable_safety_checker: false,
      seed: 0,
    };
    expect(nodeRegistry.resolveEndpoint("seedream-4.5", input)?.payload).toEqual(input);
  });

  it("forwards the source image under image_urls in edit mode", () => {
    const input = {
      mode: "edit",
      prompt: "make brighter",
      image_urls: "https://example.com/photo.jpg",
    };
    expect(nodeRegistry.resolveEndpoint("seedream-4.5", input)?.payload).toEqual(input);
  });

  it("omits unspecified options and obsolete provider fields", () => {
    const resolved = nodeRegistry.resolveEndpoint("seedream-4.5", {
      mode: "generate",
      prompt: "a cat",
      image_size: undefined,
      guidance_scale: 10,
      num_inference_steps: 40,
      aspect_ratio: "16:9",
    });
    expect(resolved?.payload).toEqual({ mode: "generate", prompt: "a cat" });
  });

  it("maps the task image output to the image handle", () => {
    expect(nodeRegistry.mapOutput("seedream-4.5", "seedream", {
      image_url: "https://fal.media/files/output.png",
    })).toEqual({ image_url: "https://fal.media/files/output.png" });
  });
});

describe("seedream palette and controls", () => {
  it("registers both the first image and complete image array outputs", () => {
    expect(nodeRegistry.get("seedream-4.5")).toBe(seedreamConfig);
    expect(seedreamConfig.isPassthrough).toBeUndefined();
    expect(seedreamConfig.outputs).toEqual([{ key: "image_url", type: "image", label: "Image" }, { key: "image_urls", type: "image", label: "All Images", multi: true }]);
    expect(nodeRegistry.getPaletteEntries()).toContainEqual(expect.objectContaining({
      type: "seedream-4.5",
      label: "Seedream 4.5",
      category: "ai",
      icon: "Sparkles",
    }));
  });

  it("requires mode and prompt and exposes generation count/safety controls", () => {
    expect(seedreamConfig.inputs.filter((input) => input.required).map((input) => input.key))
      .toEqual(["mode", "prompt"]);
    expect(seedreamConfig.inputs.filter((input) => input.isAdvanced).map((input) => input.key).sort())
      .toEqual(["enable_safety_checker", "max_images", "num_images", "seed"]);
  });
});
