"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openrouterConfig = void 0;
exports.openrouterConfig = {
    id: "openrouter-llm",
    name: "LLM (OpenRouter)",
    description: "Generate text with OpenRouter chat models",
    category: "logic",
    icon: "Bot",
    version: "1.0.0",
    inputs: [
        {
            key: "model",
            type: "select",
            label: "Model",
            required: false,
            default: "google/gemini-2.5-flash",
            isAdvanced: false,
            description: "The OpenRouter model to use",
            validation: {
                options: [
                    { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
                    { label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4-5" },
                    { label: "Llama 3 8B Instruct", value: "meta-llama/llama-3-8b-instruct" },
                ],
            },
        },
        {
            key: "system_prompt",
            type: "text",
            label: "System Prompt",
            required: false,
            isAdvanced: false,
            placeholder: "You are a helpful assistant...",
            description: "Optional system instructions for the model",
            uiVariant: "textarea",
        },
        {
            key: "user_message",
            type: "text",
            label: "User Message",
            required: true,
            isAdvanced: false,
            placeholder: "Enter your prompt...",
            description: "The user message to send to the model",
            uiVariant: "textarea",
        },
        {
            key: "max_tokens",
            type: "number",
            label: "Max Tokens",
            required: false,
            isAdvanced: true,
            default: 1024,
            description: "Maximum number of tokens to generate",
            validation: { min: 1, max: 8192 },
        },
        {
            key: "temperature",
            type: "number",
            label: "Temperature",
            required: false,
            isAdvanced: true,
            default: 0.7,
            description: "Sampling temperature. 0 = deterministic, 2 = very random",
            validation: { min: 0, max: 2 },
        },
        {
            key: "images",
            type: "image",
            label: "Images",
            required: false,
            isAdvanced: false,
            multi: true,
            description: "Optional images for multimodal vision prompts",
        },
    ],
    outputs: [
        {
            key: "text",
            type: "text",
            label: "Response Text",
        },
        {
            key: "model",
            type: "text",
            label: "Model Used",
        },
        {
            key: "finish_reason",
            type: "text",
            label: "Finish Reason",
        },
    ],
    providers: [
        {
            id: "openrouter",
            name: "OpenRouter",
            timeout: 45000,
            retryCount: 1,
            endpoints: [
                {
                    id: "openrouter-generate",
                    name: "Generate Text",
                    taskId: "openrouter-generate",
                    inputMapping: {
                        model: "model",
                        system_prompt: "system_prompt",
                        user_message: "user_message",
                        max_tokens: "max_tokens",
                        temperature: "temperature",
                        images: "images",
                    },
                    outputMapping: {
                        text: "text",
                        model: "model",
                        finish_reason: "finish_reason",
                    },
                },
            ],
        },
    ],
    credits: {
        estimate: (inputs) => {
            const model = inputs.model ?? "";
            const promptLen = inputs.user_message?.length ?? 500;
            const ratePerChar = model.includes("claude") ? 5 : 2;
            return Math.ceil(promptLen * ratePerChar);
        },
        calculate: (inputs, response) => {
            const res = response;
            const usage = res?.usage;
            if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
                const model = inputs.model ?? "";
                const inputRate = model.includes("claude") ? 3 : 1;
                const outputRate = model.includes("claude") ? 15 : 3;
                return (usage.prompt_tokens * inputRate) + (usage.completion_tokens * outputRate);
            }
            // fallback to char-based estimate
            const model = inputs.model ?? "";
            const promptLen = inputs.user_message?.length ?? 500;
            const ratePerChar = model.includes("claude") ? 5 : 2;
            return Math.ceil(promptLen * ratePerChar);
        },
    },
    ui: {
        color: "text-blue-600",
        width: 280,
        showOutputPreview: true,
        previewOutputKey: "text",
    },
};
