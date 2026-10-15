// ============================================================================
// lib/nodes/configs/seedream.config.ts — Seedream 4.5 Node Configuration
// ============================================================================
//
// Text-to-image and image editing via fal.ai's Seedream 4.5 model.
//
// ENDPOINT SELECTION:
//   - image_url present → fal-ai/bytedance/seedream/v4.5/edit        (image editing mode)
//   - image_url absent  → fal-ai/bytedance/seedream/v4.5/text-to-image (text-to-image mode)
//
// Both endpoints route to the same Trigger.dev task ("seedream-4.5").
// The task inspects the payload for image_url to determine which fal.ai
// REST endpoint to call. The edit endpoint omits image_url from its
// inputMapping so the task receives a clean signal.
//
// CREDITS:
//   - Reserve the supported maximum because image-count controls can be wired.
//   - Settle from a provider cost when supplied, or the returned image count.
// ============================================================================

import type { NodeConfig } from "../types";
import { BILLING_LIMITS, estimateNodeReservation, BILLING_RATES } from "../../credits/billing-policy";

export const seedreamConfig: NodeConfig = {
  id: "seedream-4.5",
  name: "Seedream 4.5",
  description: "Text-to-image and image editing via fal.ai",
  category: "ai",
  icon: "Sparkles",
  version: "3.0.0",

  // ---------------------------------------------------------------------------
  // INPUTS — Each generates a Handle + UI Control + Zod field
  // ---------------------------------------------------------------------------
  inputs: [
    {
      key: "mode",
      type: "select",
      label: "Mode",
      required: true,
      default: "generate",
      isAdvanced: false,
      description: "Operation mode: Text-to-Image or Image-to-Image",
      validation: {
        options: [
          { label: "Generate", value: "generate" },
          { label: "Edit", value: "edit" },
        ],
      },
    },
    {
      key: "prompt",
      validation: { maxLength: BILLING_LIMITS.promptCharacters },
      type: "text",
      label: "Prompt",
      required: true,
      isAdvanced: false,
      placeholder: "A serene mountain landscape at golden hour...",
      description: "Text description of the image to generate or edit",
      uiVariant: "textarea",
    },
    {
      key: "image_urls",
      type: "image",
      multi: true,
      label: "Image",
      required: false,
      isAdvanced: false,
      placeholder: "Select or connect an image...",
      description: "Source image for editing mode. When provided, Seedream edits this image instead of generating from scratch. Max 10 images.",
      showIf: { field: "mode", equals: "edit" },
    },
    {
      // FIX: Removed default "square_hd" to allow API fallback
      key: "image_size",
      type: "select",
      label: "Image Size",
      required: false,
      isAdvanced: false,
      description: "Output image size preset",
      validation: {
        options: [
          { label: "Square HD", value: "square_hd" },
          { label: "Square", value: "square" },
          { label: "Portrait 4:3", value: "portrait_4_3" },
          { label: "Portrait 16:9", value: "portrait_16_9" },
          { label: "Landscape 4:3", value: "landscape_4_3" },
          { label: "Landscape 16:9", value: "landscape_16_9" },
          { label: "Auto 2K", value: "auto_2K" },
          { label: "Auto 4K", value: "auto_4K" },
        ],
      },
    },
    {
      // FIX: Added missing num_images parameter
      key: "num_images",
      type: "number",
      label: "Num Images",
      required: false,
      default: 1,
      isAdvanced: true,
      description: "Number of separate model generations",
      validation: { min: 1, max: BILLING_LIMITS.imageGenerations, step: 1 },
    },
    {
      // FIX: Added missing max_images parameter
      key: "max_images",
      type: "number",
      label: "Max Images",
      required: false,
      default: 1,
      isAdvanced: true,
      description: "Enables multi-image generation per prompt",
      validation: { min: 1, max: BILLING_LIMITS.imagesPerGeneration, step: 1 },
    },
    {
      // FIX: Added missing enable_safety_checker parameter
      key: "enable_safety_checker",
      type: "boolean",
      label: "Enable Safety Checker",
      required: false,
      default: true,
      isAdvanced: true,
      description: "If set to true, the safety checker will be enabled.",
    },
    {
      key: "seed",
      type: "number",
      label: "Seed",
      required: false,
      isAdvanced: true,
      description:
        "Random seed for reproducible results. Leave empty for random.",
      validation: { min: 0, max: 2147483647, step: 1 },
    },
  ],

  // ---------------------------------------------------------------------------
  // OUTPUTS — The generated/edited image URL
  // ---------------------------------------------------------------------------
  outputs: [
    {
      key: "image_url",
      type: "image",
      label: "Image",
    },
    { key: "image_urls", type: "image", label: "All Images", multi: true },
  ],

  // ---------------------------------------------------------------------------
  // PROVIDERS — fal.ai with endpoint selection based on image_url presence
  // ---------------------------------------------------------------------------
  providers: [
    {
      id: "fal",
      name: "fal.ai",
      timeout: 300000,
      retryCount: 1,
      endpoints: [
        {
          id: "seedream",
          name: "Seedream 4.5",
          taskId: "seedream-4.5",
          inputMapping: {
            mode: "mode",
            prompt: "prompt",
            image_urls: "image_urls",
            image_size: "image_size",
            num_images: "num_images",
            max_images: "max_images",
            enable_safety_checker: "enable_safety_checker",
            seed: "seed",
          },
          outputMapping: {
            image_url: "image_url",
            image_urls: "image_urls",
          },
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // CREDITS — Maximum reservation and usage-based settlement
  // ---------------------------------------------------------------------------
  credits: {
    estimate: () => estimateNodeReservation("seedream-4.5"),
    calculate: (_inputs, response: unknown) => {
      const res = response as Record<string, unknown> | null;
      if (res && typeof res.cost === "number") {
        return Math.ceil(res.cost * 1_000_000);
      }
      const count = res?.generatedImageCount;
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > BILLING_LIMITS.imageGenerations * BILLING_LIMITS.imagesPerGeneration) {
        throw new Error("Seedream response is missing a valid generated image count");
      }
      return count * BILLING_RATES.image;
    },
  },

  // ---------------------------------------------------------------------------
  // UI — Violet accent, image preview for generated output
  // ---------------------------------------------------------------------------
  ui: {
    color: "text-violet-500",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "image_url",
  },
};

