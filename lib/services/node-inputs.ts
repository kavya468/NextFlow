import type { z } from "zod";
import type { EdgeSchema, NodeSchema } from "../schemas";
import { nodeRegistry } from "../nodes/registry";
import { areHandleTypesCompatible, canonicalSourceHandle, canonicalTargetHandle, getInputDefinition } from "../nodes/handles";
import { composeDialogueInputs, composeElementInputs, parseDialogueInputs, parseElementInputs } from "../nodes/structured-inputs";
import type { InputDefinition, NodeConfig } from "../nodes/types";
import { ValidationError } from "./errors";
import "../nodes/configs";

export type ExecutionNode = z.infer<typeof NodeSchema>;
export type ExecutionEdge = z.infer<typeof EdgeSchema>;
export type NormalizedExecutionEdge = ExecutionEdge & { sourceHandle: string; targetHandle: string };

function configuration(node: ExecutionNode): NodeConfig {
  const config = nodeRegistry.get(node.type);
  if (!config) throw new ValidationError(`Unknown node type: ${node.type}`);
  return config;
}

/** Run snapshots carry canonical ports; persisted drafts are not rewritten. */
export function normalizeExecutionEdges(nodes: ExecutionNode[], edges: ExecutionEdge[]): NormalizedExecutionEdge[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edgeIds = new Set<string>();
  const connections = new Set<string>();
  const targets = new Set<string>();
  return edges.map(edge => {
    if (edgeIds.has(edge.id)) throw new ValidationError(`Duplicate connection ID: ${edge.id}`);
    edgeIds.add(edge.id);
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) throw new ValidationError(`Connection ${edge.id} references a missing executable node`);
    if (source.id === target.id) throw new ValidationError(`Node ${source.id} cannot connect to itself`);
    const sourceConfig = configuration(source);
    const targetConfig = configuration(target);
    const sourceHandle = canonicalSourceHandle(sourceConfig, edge.sourceHandle);
    const targetHandle = canonicalTargetHandle(targetConfig, edge.targetHandle);
    if (!sourceHandle) throw new ValidationError(`Connection ${edge.id}: output ${edge.sourceHandle ?? "(missing)"} does not identify a port on ${source.id}; reconnect it`);
    if (!targetHandle) throw new ValidationError(`Connection ${edge.id}: input ${edge.targetHandle ?? "(missing)"} does not identify a port on ${target.id}; reconnect it`);
    const output = sourceConfig.outputs.find(output => output.key === sourceHandle)!;
    const input = getInputDefinition(targetConfig, targetHandle)!;
    if (!areHandleTypesCompatible(output.type, input.type) || (output.multi && !input.multi)) {
      throw new ValidationError(`Connection ${edge.id}: ${source.id}.${sourceHandle} is incompatible with ${target.id}.${targetHandle}`);
    }
    const signature = JSON.stringify([source.id, sourceHandle, target.id, targetHandle]);
    if (connections.has(signature)) throw new ValidationError(`Duplicate connection to ${target.id}.${targetHandle}`);
    connections.add(signature);
    const targetKey = JSON.stringify([target.id, targetHandle]);
    if (targets.has(targetKey) && !input.multi) throw new ValidationError(`Input ${target.id}.${targetHandle} accepts one connection; remove the extra connection`);
    targets.add(targetKey);
    return { ...edge, sourceHandle, targetHandle };
  });
}

/** Matches the public API contract: label overrides first, ID overrides last. */
export function applyNodeInputOverrides(node: ExecutionNode, inputs: Record<string, unknown>, overrides?: Record<string, unknown>): void {
  if (!overrides) return;
  const config = configuration(node);
  const label = typeof node.data.label === "string" ? node.data.label : node.type;
  const sourceKey = Object.keys(config.passthroughMapping ?? {})[0];
  if (config.isPassthrough && sourceKey && Object.hasOwn(overrides, label)) inputs[sourceKey] = overrides[label];
  for (const prefix of [`${label}.`, `${node.id}.`]) {
    for (const [key, value] of Object.entries(overrides)) if (key.startsWith(prefix)) inputs[key.slice(prefix.length)] = value;
  }
}

function withDefaults(node: ExecutionNode): Record<string, unknown> {
  const data = structuredClone(node.data);
  for (const input of configuration(node).inputs) if (data[input.key] === undefined && input.default !== undefined) data[input.key] = structuredClone(input.default);
  return data;
}

function normalizeMultiValue(nodeType: string, input: InputDefinition, value: unknown): unknown {
  if (!input.multi || value === undefined) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try { value = JSON.parse(value); }
    catch { throw new ValidationError(`${input.label} must be a URL or a valid JSON array`); }
  }
  // The merge worker has always accepted comma-separated URLs; preserve that format.
  if (nodeType === "merge-videos" && typeof value === "string") return value.split(",").map(item => item.trim()).filter(Boolean);
  return (Array.isArray(value) ? value : [value]).filter(item => item !== undefined && item !== null && item !== "");
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === "string" && !value.trim()) || (Array.isArray(value) && value.length === 0);
}

function validateRequirements(node: ExecutionNode, inputs: Record<string, unknown>, deferred = new Set<string>()): void {
  const config = configuration(node);
  for (const input of config.inputs) {
    if (input.required && !deferred.has(input.key) && isEmpty(inputs[input.key])) throw new ValidationError(`Node ${node.id}: ${input.label} is required`);
    if (["image", "video", "audio", "file"].includes(input.type) && !deferred.has(input.key) && !isEmpty(inputs[input.key])) {
      const values = Array.isArray(inputs[input.key]) ? inputs[input.key] as unknown[] : [inputs[input.key]];
      for (const value of values) assertMediaUrl(value, `${node.id}.${input.key}`);
    }
  }
  if ((node.type === "image" || node.type === "video") && isEmpty(inputs.url)) throw new ValidationError(`Node ${node.id}: upload or provide a ${node.type} URL`);
  if (node.type === "image" || node.type === "video") assertMediaUrl(inputs.url, `${node.id}.url`);
  if (!deferred.has("mode")) {
    const key = node.type === "seedream-4.5" && inputs.mode === "edit" ? "image_urls"
      : node.type === "seedance-1.5" && inputs.mode === "image-to-video" ? "image_url" : undefined;
    if (key && !deferred.has(key) && isEmpty(inputs[key])) throw new ValidationError(`Node ${node.id}: ${key} is required in ${inputs.mode} mode`);
  }
  if (node.type === "merge-videos" && !deferred.has("video_urls") && (!Array.isArray(inputs.video_urls) || inputs.video_urls.length < 2)) throw new ValidationError(`Node ${node.id}: Merge Videos needs at least two video URLs`);
}

function assertMediaUrl(value: unknown, label: string): void {
  try {
    if (typeof value !== "string" || !["http:", "https:"].includes(new URL(value).protocol)) throw new Error("invalid URL");
  } catch { throw new ValidationError(`${label} must be an HTTP(S) media URL`); }
}

function assertDynamicKeys(config: NodeConfig, inputs: Record<string, unknown>): void {
  for (const key of Object.keys(inputs)) {
    if ((key.startsWith("dialogue_text_") || key.startsWith("element_")) && !getInputDefinition(config, key)) throw new ValidationError(`Unknown dynamic input: ${key}`);
  }
}

/** Validate what is knowable before reserving credits, without treating saved wired values as actual inputs. */
export function validateStaticNodeInputs(node: ExecutionNode, edges: NormalizedExecutionEdge[], overrides?: Record<string, unknown>): void {
  const config = configuration(node);
  const inputs = withDefaults(node);
  applyNodeInputOverrides(node, inputs, overrides);
  const deferred = new Set(edges.filter(edge => edge.target === node.id).map(edge => edge.targetHandle));
  for (const key of deferred) delete inputs[key];
  for (const input of config.inputs) inputs[input.key] = normalizeMultiValue(node.type, input, inputs[input.key]);
  assertDynamicKeys(config, inputs);
  const parsed = nodeRegistry.getInputSchema(node.type).partial().safeParse(inputs);
  if (!parsed.success) throw new ValidationError(`Node ${node.id}: ${parsed.error.message}`);
  const validated = { ...inputs, ...parsed.data };
  validateRequirements(node, validated, deferred);
  if (node.type === "elevenlabs-tts" && !deferred.has("inputs")) {
    const lines = parseDialogueInputs(validated.inputs);
    for (const key of deferred) {
      const match = /^dialogue_text_(\d+)$/.exec(key);
      if (match && Number(match[1]) >= lines.length) throw new ValidationError(`Node ${node.id}: ${key} references a missing dialogue line`);
    }
    // Unknown connected text is checked at runtime; its speaker slot must already exist.
    const placeholders = Object.fromEntries([...deferred].filter(key => key.startsWith("dialogue_text_")).map(key => [key, "connected text"]));
    composeDialogueInputs({ ...validated, ...placeholders });
  }
  if (node.type === "kling-01" && !deferred.has("elements")) {
    const elements = parseElementInputs(validated.elements);
    const placeholders = Object.fromEntries([...deferred].filter(key => key.startsWith("element_")).map(key => [key, "https://connected.invalid/image"]));
    composeElementInputs({ ...validated, elements, ...placeholders });
  }
}

/** Pure worker boundary: fail missing dependencies before applying explicit runtime overrides. */
export function resolveNodeInputs(node: ExecutionNode, incomingEdges: NormalizedExecutionEdge[], upstreamOutputs: ReadonlyMap<string, Record<string, unknown>>, overrides?: Record<string, unknown>): Record<string, unknown> {
  const config = configuration(node);
  const inputs = withDefaults(node);
  const grouped = new Map<string, Array<{ edge: NormalizedExecutionEdge; value: unknown }>>();
  for (const edge of incomingEdges.filter(edge => edge.target === node.id)) {
    const output = upstreamOutputs.get(edge.source);
    if (!output || !Object.hasOwn(output, edge.sourceHandle) || output[edge.sourceHandle] == null) throw new ValidationError(`Node ${node.id}: connected output ${edge.source}.${edge.sourceHandle} is missing`);
    const input = getInputDefinition(config, edge.targetHandle);
    if (!input) throw new ValidationError(`Node ${node.id}: unknown input ${edge.targetHandle}`);
    const values = grouped.get(edge.targetHandle) ?? [];
    values.push({ edge, value: output[edge.sourceHandle] });
    grouped.set(edge.targetHandle, values);
  }
  for (const [key, values] of grouped) {
    const input = getInputDefinition(config, key)!;
    if (!input.multi && values.length > 1) throw new ValidationError(`Node ${node.id}: ${key} accepts one connection`);
    if (input.multi) {
      const orderValue = node.data._inputOrder;
      const order = orderValue && typeof orderValue === "object" ? (orderValue as Record<string, unknown>)[key] : undefined;
      // Stable sort, no Map<sourceId,value>: two distinct ports of one source must survive.
      if (Array.isArray(order)) values.sort((a, b) => {
        const rank = (edge: NormalizedExecutionEdge) => { const index = order.indexOf(edge.id); const legacy = order.indexOf(edge.source); return index >= 0 ? index : legacy >= 0 ? legacy : order.length; };
        return rank(a.edge) - rank(b.edge);
      });
      inputs[key] = values.flatMap(({ value }) => normalizeMultiValue(node.type, input, value) as unknown[]);
    } else inputs[key] = values[0].value;
  }
  applyNodeInputOverrides(node, inputs, overrides);
  for (const input of config.inputs) inputs[input.key] = normalizeMultiValue(node.type, input, inputs[input.key]);
  assertDynamicKeys(config, inputs);
  if (node.type === "elevenlabs-tts") inputs.inputs = composeDialogueInputs(inputs);
  if (node.type === "kling-01") inputs.elements = composeElementInputs(inputs);
  for (const key of Object.keys(inputs)) if (key.startsWith("_") || key.startsWith("dialogue_text_") || key.startsWith("element_")) delete inputs[key];
  const parsed = nodeRegistry.getInputSchema(node.type).safeParse(inputs);
  if (!parsed.success) throw new ValidationError(`Node ${node.id}: ${parsed.error.message}`);
  const result = parsed.data;
  // Media source URLs deliberately have no connectable input handle/schema field.
  for (const key of Object.keys(config.passthroughMapping ?? {})) if (!(key in result)) result[key] = inputs[key];
  validateRequirements(node, result);
  return result;
}

/** Only declared, typed outputs may enter downstream nodes or stored successful results. */
export function mapAndValidateNodeOutput(nodeType: string, endpointId: string, rawOutput: unknown): Record<string, unknown> {
  const config = nodeRegistry.get(nodeType);
  if (!config) throw new ValidationError(`Unknown node type: ${nodeType}`);
  if (!rawOutput || typeof rawOutput !== "object" || Array.isArray(rawOutput)) throw new ValidationError(`${config.name} returned an invalid output object`);
  if (!config.isPassthrough && !config.providers.some(provider => provider.endpoints.some(endpoint => endpoint.id === endpointId))) throw new ValidationError(`Unknown output endpoint for ${config.name}: ${endpointId}`);
  const mapped = nodeRegistry.mapOutput(nodeType, endpointId, rawOutput as Record<string, unknown>);
  const parsed = nodeRegistry.getOutputSchema(nodeType).safeParse(mapped);
  if (!parsed.success) throw new ValidationError(`${config.name} returned invalid output: ${parsed.error.message}`);
  return parsed.data;
}
