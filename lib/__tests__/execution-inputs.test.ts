import { describe, expect, it } from "vitest";
import { prepareExecutionGraph } from "../services/execution-graph";
import {
  mapAndValidateNodeOutput, normalizeExecutionEdges, resolveNodeInputs, validateStaticNodeInputs,
  type ExecutionEdge, type ExecutionNode,
} from "../services/node-inputs";
import { nodeRegistry } from "../nodes/registry";
import { composeDialogueInputs } from "../nodes/structured-inputs";

const image1 = "https://media.example/first.png";
const image2 = "https://media.example/second.png";
const video1 = "https://media.example/first.mp4";
const video2 = "https://media.example/second.mp4";
const node = (id: string, type: string, data: Record<string, unknown> = {}): ExecutionNode => ({ id, type, data, position: { x: 0, y: 0 } });
const edge = (id: string, source: string, sourceHandle: string | null, target: string, targetHandle: string | null): ExecutionEdge => ({ id, source, sourceHandle, target, targetHandle });

describe("execution graph ports and static validation", () => {
  it("rejects missing nodes, handles and incompatible media before a run", () => {
    const nodes = [node("image", "image", { url: image1 }), node("merge", "merge-audio-video", { video_url: video1 })];
    for (const connection of [
      edge("e", "missing", "image_url", "merge", "audio_url"),
      edge("e", "image", "typo", "merge", "audio_url"),
      edge("e", "image", "image_url", "merge", "typo"),
      edge("e", "image", "image_url", "merge", "audio_url"),
    ]) expect(() => prepareExecutionGraph(nodes, [connection])).toThrow();
  });

  it("normalizes only evidenced aliases without rewriting the draft", () => {
    const nodes = [node("text", "text", { text: "Hello" }), node("tts", "elevenlabs-tts")];
    const original = edge("e", "text", "text", "tts", "text");
    expect(prepareExecutionGraph(nodes, [original]).edges[0]).toMatchObject({ sourceHandle: "text_output", targetHandle: "inputs" });
    expect(original).toMatchObject({ sourceHandle: "text", targetHandle: "text" });
    const legacy = normalizeExecutionEdges([node("image", "image"), node("crop", "crop")], [edge("e", "image", "output", "crop", "image_url")]);
    expect(legacy[0].sourceHandle).toBe("image_url");
  });

  it("infers a missing handle only for an unambiguous port, with Seedream's old primary image preserved", () => {
    expect(normalizeExecutionEdges([node("a", "video"), node("b", "extract-audio")], [edge("e", "a", null, "b", null)])[0]).toMatchObject({ sourceHandle: "video_url", targetHandle: "video_url" });
    expect(normalizeExecutionEdges([node("a", "seedream-4.5"), node("b", "crop")], [edge("e", "a", "output", "b", "image_url")])[0].sourceHandle).toBe("image_url");
    expect(() => normalizeExecutionEdges([node("a", "openrouter-llm"), node("b", "llm")], [edge("e", "a", null, "b", "user_message")])).toThrow("output");
    expect(() => normalizeExecutionEdges([node("a", "text"), node("b", "llm")], [edge("e", "a", "text_output", "b", null)])).toThrow("input");
  });

  it("rejects duplicate IDs, duplicate wires, self-loops, and multiple single-input wires", () => {
    const nodes = [node("a", "text"), node("b", "text"), node("c", "llm")];
    const first = edge("one", "a", "text_output", "c", "user_message");
    const second = edge("two", "b", "text_output", "c", "user_message");
    expect(() => normalizeExecutionEdges(nodes, [first, { ...second, id: "one" }])).toThrow("ID");
    expect(() => normalizeExecutionEdges(nodes, [first, { ...first, id: "two" }])).toThrow("Duplicate connection");
    expect(() => normalizeExecutionEdges(nodes, [first, second])).toThrow("one connection");
    expect(() => normalizeExecutionEdges(nodes, [edge("loop", "a", "text_output", "a", "text")])).toThrow("itself");
  });

  it("rejects missing static required fields while ignoring stale values behind a valid wire", () => {
    expect(() => prepareExecutionGraph([node("llm", "llm", { user_message: " " })], [])).toThrow("required");
    expect(() => prepareExecutionGraph([node("llm", "llm")], [])).toThrow("required");
    const graph = prepareExecutionGraph([node("text", "text", { text: "Brief" }), node("llm", "llm", { user_message: 123 })], [edge("e", "text", "text_output", "llm", "user_message")]);
    expect(graph.nodes).toHaveLength(2);
  });

  it("validates mode-dependent inputs and applies documented defaults", () => {
    expect(() => prepareExecutionGraph([node("image", "seedream-4.5", { prompt: "Cat" })], [])).not.toThrow();
    expect(() => prepareExecutionGraph([node("image", "seedream-4.5", { prompt: "Cat", mode: "edit" })], [])).toThrow("image_urls");
    expect(() => prepareExecutionGraph([node("video", "seedance-1.5", { prompt: "Cat", mode: "image-to-video" })], [])).toThrow("image_url");
    expect(() => prepareExecutionGraph([node("merge", "merge-videos", { video_urls: [video1] })], [])).toThrow("at least two");
    expect(() => prepareExecutionGraph([node("image", "image")], [])).toThrow("provide");
  });

  it("bounds graph size before traversal", () => {
    expect(() => prepareExecutionGraph(Array.from({ length: 201 }, (_, i) => node(String(i), "text")), [])).toThrow("200 nodes");
    expect(() => prepareExecutionGraph([node("a", "text")], Array.from({ length: 1001 }, (_, i) => edge(String(i), "a", "text_output", "a", "text")))).toThrow("1,000 connections");
  });

  it("validates only the selected upstream closure's required fields", () => {
    const graph = prepareExecutionGraph([node("a", "text", { text: "Hello" }), node("b", "llm"), node("unrelated", "llm")], [edge("e", "a", "text_output", "b", "user_message")], ["b"]);
    expect(graph.nodes.map(n => n.id)).toEqual(["a", "b"]);
  });
});

describe("shared node input composition", () => {
  it("carries text through an LLM to the exact Seedream provider payload", () => {
    const graph = prepareExecutionGraph([node("brief", "text", { text: "Draft a scene" }), node("llm", "llm"), node("image", "seedream-4.5")], [edge("a", "brief", "text_output", "llm", "user_message"), edge("b", "llm", "text", "image", "prompt")]);
    const outputs = new Map<string, Record<string, unknown>>();
    const brief = resolveNodeInputs(graph.nodes[0], graph.edges, outputs);
    outputs.set("brief", nodeRegistry.resolvePassthrough("text", brief)!);
    const modelInputs = resolveNodeInputs(graph.nodes[1], graph.edges, outputs);
    expect(nodeRegistry.resolveEndpoint("llm", modelInputs)?.payload).toMatchObject({ userMessage: "Draft a scene", max_tokens: 2048 });
    outputs.set("llm", mapAndValidateNodeOutput("llm", "llm-generate", { text: "A bright seascape" }));
    const imageInputs = resolveNodeInputs(graph.nodes[2], graph.edges, outputs);
    expect(nodeRegistry.resolveEndpoint("seedream-4.5", imageInputs)?.payload).toEqual({ mode: "generate", prompt: "A bright seascape", num_images: 1, max_images: 1, enable_safety_checker: true });
  });

  it("never falls back to stale saved data or another output key", () => {
    const nodes = [node("source", "openrouter-llm"), node("target", "llm", { user_message: "stale" })];
    const edges = normalizeExecutionEdges(nodes, [edge("e", "source", "text", "target", "user_message")]);
    for (const outputs of [new Map<string, Record<string, unknown>>(), new Map([["source", { model: "other-field" }]]), new Map([["source", { text: undefined }]])]) {
      expect(() => resolveNodeInputs(nodes[1], edges, outputs, { "target.user_message": "override" })).toThrow("connected output");
    }
    expect(() => resolveNodeInputs(nodes[1], edges, new Map([["source", { text: "" }]]))).toThrow("required");
  });

  it("preserves explicit label then ID override precedence after wiring", () => {
    const target = node("target", "llm", { label: "Writer", user_message: "static" });
    const edges = normalizeExecutionEdges([node("source", "text"), target], [edge("e", "source", "text_output", "target", "user_message")]);
    expect(resolveNodeInputs(target, edges, new Map([["source", { text_output: "wired" }]]), { "Writer.user_message": "by label", "target.user_message": "by id" }).user_message).toBe("by id");
    expect(resolveNodeInputs(node("source", "text", { label: "Brief" }), [], new Map(), { Brief: "label", "source.text": "id" }).text).toBe("id");
  });

  it("flattens scalar and array image outputs while preserving repeated source ports and requested ordering", () => {
    const target = node("target", "llm", { user_message: "Describe", _inputOrder: { images: ["other", "source"] } });
    const nodes = [node("source", "seedream-4.5"), node("other", "image"), target];
    const edges = normalizeExecutionEdges(nodes, [edge("a", "source", "image_url", "target", "images"), edge("b", "source", "image_urls", "target", "images"), edge("c", "other", "image_url", "target", "images")]);
    expect(resolveNodeInputs(target, edges, new Map([["source", { image_url: image1, image_urls: [image1, image2] }], ["other", { image_url: image2 }]])).images).toEqual([image2, image1, image1, image2]);
  });

  it("supports Seedream edit arrays and rejects an array output on a scalar port", () => {
    const source = node("source", "seedream-4.5");
    const target = node("edit", "seedream-4.5", { mode: "edit", prompt: "Brighter" });
    const edges = normalizeExecutionEdges([source, target], [edge("e", "source", "image_urls", "edit", "image_urls")]);
    const inputs = resolveNodeInputs(target, edges, new Map([["source", { image_urls: [image1, image2] }]]));
    expect(nodeRegistry.resolveEndpoint(target.type, inputs)?.payload.image_urls).toEqual([image1, image2]);
    expect(() => normalizeExecutionEdges([source, node("crop", "crop")], [edge("e", "source", "image_urls", "crop", "image_url")])).toThrow("incompatible");
  });

  it("normalizes comma-separated merge inputs and keeps edge order for video chains", () => {
    const target = node("merge", "merge-videos");
    const nodes = [node("source", "text"), node("second", "video"), target];
    const edges = normalizeExecutionEdges(nodes, [edge("e1", "source", "text_output", "merge", "video_urls"), edge("e2", "second", "video_url", "merge", "video_urls")]);
    expect(resolveNodeInputs(target, edges, new Map([["source", { text_output: `${video1}, ${video2}` }], ["second", { video_url: video1 }]])).video_urls).toEqual([video1, video2, video1]);
    expect(resolveNodeInputs(node("merge", "merge-videos", { video_urls: JSON.stringify([video1, video2]) }), [], new Map()).video_urls).toEqual([video1, video2]);
  });

  it("treats the literal false as false and rejects ambiguous boolean strings", () => {
    const target = node("video", "seedance-1.5", { prompt: "Cat", generate_audio: "false" });
    expect(resolveNodeInputs(target, [], new Map()).generate_audio).toBe(false);
    expect(() => resolveNodeInputs({ ...target, data: { ...target.data, generate_audio: "no" } }, [], new Map())).toThrow();
  });

  it("preserves source URLs while dropping internal/UI fields from task payloads", () => {
    const source = node("source", "image", { url: image1, _private: "do not send", label: "Reference" });
    expect(resolveNodeInputs(source, [], new Map())).toEqual({ url: image1 });
    expect(() => resolveNodeInputs({ ...source, data: { url: "file:///etc/passwd" } }, [], new Map())).toThrow("HTTP(S)");
  });
});

describe("structured dynamic handles", () => {
  it("merges a connected dialogue line into its exact voice slot", () => {
    const target = node("voice", "elevenlabs-tts", { inputs: JSON.stringify([{ text: "first", voice: "Aria" }, { text: "", voice: "Roger" }]) });
    const graph = prepareExecutionGraph([node("source", "text", { text: "connected second line" }), target], [edge("e", "source", "text_output", "voice", "dialogue_text_1")]);
    const inputs = resolveNodeInputs(graph.nodes[1], graph.edges, new Map([["source", { text_output: "connected second line" }]]));
    expect(nodeRegistry.resolveEndpoint(target.type, inputs)?.payload.inputs).toEqual([{ text: "first", voice: "Aria" }, { text: "connected second line", voice: "Roger" }]);
    expect(inputs).not.toHaveProperty("dialogue_text_1");
  });

  it("rejects dangling and malformed dialogue handles, including huge indices", () => {
    const target = node("voice", "elevenlabs-tts", { inputs: [{ text: "first", voice: "Aria" }] });
    for (const handle of ["dialogue_text_1", "dialogue_text_999999999999999999999", "dialogue_text_invalid"]) {
      expect(() => prepareExecutionGraph([node("source", "text"), target], [edge("e", "source", "text_output", "voice", handle)])).toThrow();
    }
  });

  it("preserves unmatched script lines instead of silently dropping text", () => {
    expect(composeDialogueInputs({ inputs: "Aria: Hello\nAn unmatched line" })).toEqual([{ text: "Aria: Hello", voice: "default" }, { text: "An unmatched line", voice: "default" }]);
    expect(composeDialogueInputs({ inputs: "Aria: Hello\nRoger: Hi" })).toEqual([{ text: "Hello", voice: "Aria" }, { text: "Hi", voice: "Roger" }]);
  });

  it("preserves element and reference indices without sparse allocation or compaction", () => {
    const target = node("kling", "kling-01", { mode: "reference", prompt: "Use @Element3", video_url: video1, elements: [
      { frontal_image_url: image1, reference_image_urls: [] },
      { frontal_image_url: image2, reference_image_urls: [] },
      { frontal_image_url: "", reference_image_urls: [image1, image2, ""] },
    ] });
    const edges = normalizeExecutionEdges([node("source", "image"), target], [edge("front", "source", "image_url", "kling", "element_2_frontal"), edge("ref", "source", "image_url", "kling", "element_2_ref_2")]);
    expect(() => validateStaticNodeInputs(target, edges)).not.toThrow();
    expect(resolveNodeInputs(target, edges, new Map([["source", { image_url: image2 }]])).elements).toEqual([
      { frontal_image_url: image1, reference_image_urls: [] },
      { frontal_image_url: image2, reference_image_urls: [] },
      { frontal_image_url: image2, reference_image_urls: [image1, image2, image2] },
    ]);
    const bad = normalizeExecutionEdges([node("source", "image"), target], [edge("bad", "source", "image_url", "kling", "element_2_ref_999999999")]);
    expect(() => resolveNodeInputs(target, bad, new Map([["source", { image_url: image1 }]]))).toThrow("missing reference slot");
  });
});

describe("mapped result contract", () => {
  it("preserves all Seedream images without leaking provider usage metadata", () => {
    expect(mapAndValidateNodeOutput("seedream-4.5", "seedream", { image_url: image1, image_urls: [image1, image2], generatedImageCount: 2, private: "secret" })).toEqual({ image_url: image1, image_urls: [image1, image2] });
  });

  it("rejects missing or incorrectly typed primary output rather than recording success", () => {
    for (const result of [{}, { image_url: 123 }, { image_url: "not a URL" }, { image_url: image1, image_urls: [] }]) {
      expect(() => mapAndValidateNodeOutput("seedream-4.5", "seedream", result)).toThrow();
    }
    expect(() => mapAndValidateNodeOutput("llm", "unknown", { text: "Hello" })).toThrow("endpoint");
  });

  it("permits absent optional provider metadata", () => {
    expect(mapAndValidateNodeOutput("seedance-1.5", "seedance-image-to-video", { video_url: video1 })).toMatchObject({ video_url: video1 });
    expect(mapAndValidateNodeOutput("openrouter-llm", "openrouter-generate", { text: "Hello", model: "google/gemini-2.5-flash" })).toMatchObject({ text: "Hello" });
  });
});
