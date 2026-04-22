// ============================================================================
// lib/nodes/configs/elevenlabs.config.ts — ElevenLabs V3 Text-to-Dialogue Node
// ============================================================================
//
// Multi-speaker dialogue generation via fal.ai's ElevenLabs V3 proxy.
//
// Endpoint: fal-ai/elevenlabs/text-to-dialogue/eleven-v3
//
// SCHEMA FIELDS (from OpenAPI spec):
//   Required: inputs (DialogueBlock[])
//   Optional: stability, use_speaker_boost, pronunciation_dictionary_locators,
//             seed, language_code
//
// OUTPUT: audio (File object with .url), seed
// ============================================================================

import type { NodeConfig } from "../types";

export const elevenlabsConfig: NodeConfig = {
  id: "elevenlabs-tts",
  name: "Text to Dialogue",
  description:
    "Generate multi-speaker dialogue audio via ElevenLabs V3 on fal.ai",
  category: "ai",
  icon: "AudioLines",
  version: "2.0.0",

  inputs: [
    // ── Standard inputs (always visible) ──────────────────────────────
    // FIX: Changed text/voice to an `inputs` array representation matching the API
    {
      key: "inputs",
      type: "text",
      label: "Dialogue Lines",
      required: true,
      isAdvanced: false,
      placeholder: "Add dialogue lines below",
      description:
        "Add speaker lines with voice selection and text. Connect a Text node to provide dialogue as JSON.",
      uiVariant: "dialogue-editor",
    },

    // ── Advanced inputs (behind accordion) ────────────────────────────
    {
      key: "stability",
      type: "number",
      label: "Stability",
      required: false,
      // FIX: removed default: 0.5 — API spec defines no default; omitting lets the API use its own internal default
      isAdvanced: true,
      description:
        "Voice stability (0, 0.5, or 1). Lower = more expressive, higher = more consistent. Rounded to nearest valid value.",
      validation: { min: 0, max: 1, step: 0.5 },
      uiVariant: "slider",
    },
    {
      key: "use_speaker_boost",
      type: "boolean",
      label: "Speaker Boost",
      required: false,
      // FIX: removed default: false — API spec defines no default; omitting lets the API use its own internal default
      isAdvanced: true,
      description:
        "Boosts similarity to the original speaker. Increases latency slightly.",
    },
    {
      key: "language_code",
      type: "text",
      label: "Language Code",
      required: false,
      isAdvanced: true,
      placeholder: "en",
      description:
        "ISO 639-1 language code to enforce a language for the model (e.g. en, es, fr).",
    },
    {
      key: "seed",
      type: "number",
      label: "Seed (optional)",
      required: false,
      isAdvanced: true,
      placeholder: "e.g. 42",
      description:
        "Numeric seed for reproducible results. Leave empty for random.",
      // FIX: added step: 1 to enforce integer values per API spec (seed is integer, not float)
      validation: { step: 1 },
    },
    {
      key: "pronunciation_dictionary_locators",
      type: "text",
      label: "Pronunciation Dictionaries",
      required: false,
      isAdvanced: true,
      placeholder: '[{"id": "dict_123", "version_id": "v1"}]',
      description:
        "JSON array of up to 3 pronunciation dictionary locators.",
      uiVariant: "textarea",
    },
  ],

  outputs: [
    {
      key: "audio_url",
      type: "audio",
      label: "Generated Audio",
    }
  ],

  providers: [
    {
      id: "fal-ai",
      name: "fal.ai",
      timeout: 300000,
      retryCount: 1,
      endpoints: [
        {
          id: "elevenlabs-generate",
          name: "Text to Dialogue",
          taskId: "elevenlabs-generate",
          inputMapping: {
            inputs: "inputs", // Changed from text/voice to inputs
            stability: "stability",
            use_speaker_boost: "use_speaker_boost",
            language_code: "language_code",
            seed: "seed",
            pronunciation_dictionary_locators: "pronunciation_dictionary_locators",
          },
          outputMapping: {
            audio_url: "audio_url",
            seed: "seed",
          },
        },
      ],
    },
  ],

  credits: {
    estimate: (inputs) => {
      // rough estimate, normally would count chars in JSON array
      const str = typeof inputs.inputs === 'string' ? inputs.inputs : JSON.stringify(inputs.inputs || []);
      return Math.ceil(str.length * 100);
    },
    calculate: (inputs, response: unknown) => {
      const res = response as Record<string, unknown> | null;
      if (res && typeof res.cost === "number") {
        return Math.ceil(res.cost * 1_000_000);
      }
      const str = typeof inputs.inputs === 'string' ? inputs.inputs : JSON.stringify(inputs.inputs || []);
      return Math.ceil(str.length * 100);
    },
  },

  ui: {
    color: "text-violet-400",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "audio_url",
  },

  // Dynamic handles: The DialogueEditor renders per-line text handles
  // (dialogue_text_0, dialogue_text_1, ...) that need to survive Zod validation.
  allowDynamicHandles: true,
};
