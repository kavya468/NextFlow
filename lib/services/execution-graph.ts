import { NodeSchema, EdgeSchema } from "@/lib/schemas";
import { nodeRegistry } from "@/lib/nodes/registry";
import { deduplicatePassthroughLabels } from "@/lib/nodes/exposed-inputs";
import { ValidationError } from "./errors";
import { z } from "zod";
import { assertNodeBillingAvailable } from "@/lib/credits/billing-policy";
import { applyNodeInputOverrides, normalizeExecutionEdges, validateStaticNodeInputs } from "./node-inputs";
import "@/lib/nodes/configs";

/** Resolve the exact graph before estimating or reserving any credits. */
export function prepareExecutionGraph(nodes: unknown, edges: unknown, selected?: string[], overrides?: Record<string, unknown>) {
  const parsed = z.object({ nodes: z.array(NodeSchema).min(1).max(200, "A workflow can contain at most 200 nodes"), edges: z.array(EdgeSchema).max(1000, "A workflow can contain at most 1,000 connections") }).safeParse({ nodes, edges });
  if (!parsed.success) throw new ValidationError(parsed.error.message);
  let executable = structuredClone(parsed.data.nodes.filter(n => n.type !== "note"));
  const ids = new Set(executable.map(n => n.id));
  if (!executable.length || ids.size !== executable.length) throw new ValidationError("Executable node IDs must be unique and nonempty");
  let connections = parsed.data.edges;
  if (connections.some(e => !ids.has(e.source) || !ids.has(e.target))) throw new ValidationError("An edge references a missing executable node");
  if (selected) {
    if (!selected.length || selected.some(id => !ids.has(id))) throw new ValidationError("Select existing executable nodes");
    const included = new Set(selected);
    const pending = [...selected];
    while (pending.length) {
      const current = pending.pop();
      for (const edge of connections) if (edge.target === current && !included.has(edge.source)) {
        included.add(edge.source);
        pending.push(edge.source);
      }
    }
    executable = executable.filter(n => included.has(n.id));
    connections = connections.filter(e => included.has(e.source) && included.has(e.target));
  }
  const indegree = new Map(executable.map(n => [n.id, 0]));
  for (const edge of connections) indegree.set(edge.target, indegree.get(edge.target)! + 1);
  const pending = executable.filter(n => indegree.get(n.id) === 0).map(n => n.id);
  let visited = 0;
  while (pending.length) {
    const current = pending.pop();
    visited++;
    for (const edge of connections) if (edge.source === current) {
      const remaining = indegree.get(edge.target)! - 1;
      indegree.set(edge.target, remaining);
      if (remaining === 0) pending.push(edge.target);
    }
  }
  if (visited !== executable.length) throw new ValidationError("Workflow contains a cycle");
  deduplicatePassthroughLabels(executable, nodeRegistry);
  const normalizedConnections = normalizeExecutionEdges(executable, connections);
  for (const node of executable) {
    const config = nodeRegistry.get(node.type);
    if (!config) throw new ValidationError(`Unknown node type: ${node.type}`);
    assertNodeBillingAvailable(node.type);
    applyNodeInputOverrides(node, node.data, overrides);
    validateStaticNodeInputs(node, normalizedConnections, overrides);
  }
  return { nodes: executable, edges: normalizedConnections, scope: selected ? (selected.length === 1 ? "SINGLE" : "PARTIAL") : "FULL" };
}
