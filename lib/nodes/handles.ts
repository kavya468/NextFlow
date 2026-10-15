import type { InputDefinition, IOType, NodeConfig } from "./types";

/** Compatibility is about media semantics, not merely all URLs being strings. */
export function areHandleTypesCompatible(source: IOType, target: IOType): boolean {
  if (source === target || source === "text") return true;
  return ["image", "video", "audio", "file"].includes(source) && target === "text";
}

export function getInputDefinition(config: NodeConfig, handle: string): InputDefinition | undefined {
  const input = config.inputs.find(input => input.key === handle);
  if (input) return input;
  if (!config.allowDynamicHandles) return undefined;
  if (config.id === "elevenlabs-tts" && /^dialogue_text_(0|[1-9]\d*)$/.test(handle)) {
    return { key: handle, label: "Dialogue line", type: "text", required: true, isAdvanced: false };
  }
  if (config.id === "kling-01" && /^element_(0|[1-9]\d*)_(frontal|ref_(0|[1-9]\d*))$/.test(handle)) {
    return { key: handle, label: "Element image", type: "image", required: true, isAdvanced: false };
  }
  return undefined;
}

/** Only documented legacy names are repaired; unknown names never guess a port. */
export function canonicalSourceHandle(config: NodeConfig, handle?: string | null): string | undefined {
  if (config.outputs.some(output => output.key === handle)) return handle!;
  if (config.id === "text" && handle === "text") return "text_output";
  // Seedream originally exposed one image; the new array port must not change old wires.
  if (config.id === "seedream-4.5" && (!handle || handle === "output")) return "image_url";
  if ((!handle || handle === "output") && config.outputs.length === 1) return config.outputs[0].key;
  return undefined;
}

export function canonicalTargetHandle(config: NodeConfig, handle?: string | null): string | undefined {
  if (handle && getInputDefinition(config, handle)) return handle;
  if (config.id === "elevenlabs-tts" && handle === "text") return "inputs";
  if (!handle && config.inputs.length === 1) return config.inputs[0].key;
  return undefined;
}
