// ============================================================================
// lib/nodes/configs/llm.ts — LLM (Large Language Model) Node Configuration
// ============================================================================
//
// Replaces:
//   - components/nodes/LLMNode.tsx (112 lines of hand-coded React)
//   - The if/else branch in orchestrator.ts lines 109-118
//   - The hardcoded "LLM Node" entry in LeftSidebar.tsx
//
// From this config, the system auto-generates:
//   - The React Flow node UI (GenericNode.tsx renders model select, prompt
//     textarea, linked-status handles, and a text output preview area)
//   - The sidebar palette entry ("LLM" with Bot icon, category "ai")
//   - The Zod input schema (model: enum, system_prompt: string?, ...)
//   - The orchestrator dispatch (taskId: "generate-llm-content", mapped payload)
//   - Maximum credit reservation and token-usage settlement
// ============================================================================

import type { NodeConfig } from "../types";
import { BILLING_LIMITS, estimateNodeReservation } from "../../credits/billing-policy";

export const llmConfig: NodeConfig = {
  id: "llm",
  name: "LLM",
  description: "Generate text using a large language model",
  category: "ai",
  icon: "Bot",
  version: "2.0.0",

  // ---------------------------------------------------------------------------
  // INPUTS — Each generates a Handle + UI Control + Zod field
  // ---------------------------------------------------------------------------
  inputs: [
    {
      key: "model",
      type: "select",
      label: "Model",
      required: false,
      default: "gemini-2.5-flash",
      isAdvanced: false,
      description: "The LLM model to use for generation",
      validation: {
        options: [
          { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
          { label: "Gemini Pro", value: "gemini-pro" },
        ],
      },
    },
    {
      key: "system_prompt",
      validation: { maxLength: BILLING_LIMITS.systemPromptCharacters },
      type: "text",
      label: "System Prompt",
      required: false,
      isAdvanced: false,
      placeholder: "You are a helpful assistant...",
      description: "System instructions that set the LLM's behavior",
      uiVariant: "textarea",
    },
    {
      key: "user_message",
      validation: { maxLength: BILLING_LIMITS.userMessageCharacters },
      type: "text",
      label: "User Message",
      required: true,
      isAdvanced: false,
      placeholder: "Enter your prompt...",
      description: "The user message to send to the model",
      uiVariant: "textarea",
    },
    {
      key: "images",
      type: "image",
      label: "Images",
      required: false,
      isAdvanced: false,
      multi: true,
      description: "Optional images for multimodal vision (Gemini vision)",
    },
    {
      key: "temperature",
      type: "number",
      label: "Temperature",
      required: false,
      default: 0.7,
      isAdvanced: true,
      description: "Controls randomness — lower is more deterministic",
      validation: { min: 0, max: 2, step: 0.1 },
      uiVariant: "slider",
    },
    {
      key: "max_tokens",
      type: "number",
      label: "Max Tokens",
      required: false,
      default: 2048,
      isAdvanced: true,
      description: "Maximum number of tokens to generate",
      validation: { min: 1, max: BILLING_LIMITS.outputTokens, step: 1 },
    },
  ],

  // ---------------------------------------------------------------------------
  // OUTPUTS — Each generates a Handle + optional preview
  // ---------------------------------------------------------------------------
  outputs: [
    {
      key: "text",
      type: "text",
      label: "Result",
    },
  ],

  // ---------------------------------------------------------------------------
  // PROVIDERS — Gemini via Trigger.dev task (fallback-ready for OpenRouter)
  // ---------------------------------------------------------------------------
  providers: [
    {
      id: "gemini",
      name: "Google Gemini",
      timeout: 120000,
      retryCount: 3,
      endpoints: [
        {
          id: "llm-generate",
          name: "Generate Text",
          taskId: "generate-llm-content",
          inputMapping: {
            model: "model",
            system_prompt: "systemPrompt",
            user_message: "userMessage",
            images: "images",
            max_tokens: "max_tokens",
            temperature: "temperature",
          },
          outputMapping: {
            text: "text",
          },
        },
      ],
    },
  ],

  // ---------------------------------------------------------------------------
  // CREDITS — Maximum reservation and token-usage settlement
  // ---------------------------------------------------------------------------
  credits: {
    estimate: () => estimateNodeReservation("llm"),
    calculate: (inputs, response: unknown) => {
      const res = response as Record<string, unknown> | null;
      const usage = res?.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
        const model = (inputs.model as string) ?? "";
        const inputRate = model.includes("claude") ? 3 : 1;
        const outputRate = model.includes("claude") ? 15 : 3;
        return (usage.prompt_tokens * inputRate) + (usage.completion_tokens * outputRate);
      }
      const model = (inputs.model as string) ?? "";
      const msg = String(inputs.user_message || "");
      const ratePerChar = model.includes("claude") ? 5 : 2;
      return Math.ceil(msg.length * ratePerChar) + 2_000;
    },
  },

  // ---------------------------------------------------------------------------
  // UI — Visual metadata for GenericNode renderer
  // ---------------------------------------------------------------------------
  ui: {
    color: "text-blue-400",
    width: 280,
    showOutputPreview: true,
    previewOutputKey: "text",
  },
};
