// ============================================================================
// lib/services/mcp-builder-service.ts — Smart Builder Service Layer
// ============================================================================
//
// Pure business logic for the Smart Builder MCP tools:
//   1. listNodeTypes    — discovery
//   2. validateDAG      — validation & cost
//   3. autoLayoutNodes  — auto-position nodes in a left-to-right flow
//   4. autoWireEdges    — resolve missing handles by type compatibility
//   5. scaffoldWorkflow — one-shot validate, wire, layout, persist
// ============================================================================

import { prisma } from "@/lib/db";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: register all node configs

// ── Types ──────────────────────────────────────────────────────────────────

export interface NodeTypeSummary {
  type: string;
  label: string;
  description: string;
  category: string;
  creditCost: number;
  inputs: {
    key: string;
    type: string;
    label: string;
    required: boolean;
    default?: unknown;
    description?: string;
    options?: Array<{ label: string; value: string }>;
  }[];
  outputs: {
    key: string;
    type: string;
    label: string;
  }[];
}

export interface ProposedNode {
  id: string;
  type: string;
  config?: Record<string, unknown>;
}

export interface ProposedEdge {
  sourceId: string;
  targetId: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface DAGReport {
  valid: boolean;
  estimatedCredits: number;
  errors: string[];
  warnings: string[];
}

export interface ResolvedEdge {
  sourceId: string;
  targetId: string;
  sourceHandle: string;
  targetHandle: string;
}

interface PositionedNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  label: string;
}

// ── 1. listNodeTypes ───────────────────────────────────────────────────────

export function listNodeTypes(category?: string): NodeTypeSummary[] {
  let configs = nodeRegistry.getAll();

  if (category) {
    configs = configs.filter(
      (c) => c.category.toLowerCase() === category.toLowerCase()
    );
  }

  return configs.map((cfg) => ({
    type: cfg.id,
    label: cfg.name,
    description: cfg.description,
    category: cfg.category,
    creditCost: cfg.credits.estimate({}),
    inputs: cfg.inputs.map((i) => ({
      key: i.key,
      type: i.type,
      label: i.label,
      required: i.required,
      default: i.default,
      description: i.description,
      options: i.validation?.options,
    })),
    outputs: cfg.outputs.map((o) => ({
      key: o.key,
      type: o.type,
      label: o.label,
    })),
  }));
}

// ── 2. validateDAG (pure, no DB) ───────────────────────────────────────────

export function validateDAG(
  nodes: ProposedNode[],
  edges: ProposedEdge[]
): DAGReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  let estimatedCredits = 0;

  // 1. Check for empty graph
  if (nodes.length === 0) {
    errors.push("Workflow has no nodes.");
    return { valid: false, estimatedCredits: 0, errors, warnings };
  }

  // 2. Validate node types exist in registry + check duplicate IDs
  const nodeMap = new Map<string, ProposedNode>();
  for (const node of nodes) {
    if (nodeMap.has(node.id)) {
      errors.push(`Duplicate node ID: "${node.id}".`);
      continue;
    }
    nodeMap.set(node.id, node);

    if (!nodeRegistry.has(node.type)) {
      errors.push(
        `Unknown node type "${node.type}" on node "${node.id}". Use list_node_types to see valid types.`
      );
      continue;
    }

    // Estimate credits
    estimatedCredits += nodeRegistry.estimateCredits(
      node.type,
      node.config ?? {}
    );
  }

  // 3. Validate edges reference existing nodes
  for (const edge of edges) {
    if (!nodeMap.has(edge.sourceId)) {
      errors.push(`Edge references unknown source node "${edge.sourceId}".`);
    }
    if (!nodeMap.has(edge.targetId)) {
      errors.push(`Edge references unknown target node "${edge.targetId}".`);
    }
  }

  // 4. Cycle detection (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adj.set(node.id, []);
  }
  for (const edge of edges) {
    if (adj.has(edge.sourceId) && inDegree.has(edge.targetId)) {
      adj.get(edge.sourceId)!.push(edge.targetId);
      inDegree.set(edge.targetId, inDegree.get(edge.targetId)! + 1);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;
    for (const neighbor of adj.get(current) ?? []) {
      const newDeg = inDegree.get(neighbor)! - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (processed < nodes.length) {
    errors.push(
      "Cycle detected in workflow graph. DAGs cannot contain loops."
    );
  }

  // 5. Check required inputs that have no default and no incoming edge
  const targetsWithEdge = new Set(
    edges.map((e) => `${e.targetId}:${e.targetHandle ?? ""}`)
  );

  for (const node of nodes) {
    const cfg = nodeRegistry.get(node.type);
    if (!cfg) continue;

    for (const input of cfg.inputs) {
      if (!input.required) continue;
      if (input.default !== undefined) continue;

      const hasEdge =
        targetsWithEdge.has(`${node.id}:${input.key}`) ||
        targetsWithEdge.has(`${node.id}:`);
      const hasValue =
        node.config?.[input.key] !== undefined &&
        node.config?.[input.key] !== "";

      if (!hasEdge && !hasValue) {
        warnings.push(
          `Node "${node.id}" (${node.type}): required input "${input.key}" has no value and no incoming edge.`
        );
      }
    }
  }

  // 6. Warn about disconnected nodes (only when >1 node)
  if (nodes.length > 1) {
    const connectedNodes = new Set<string>();
    for (const edge of edges) {
      connectedNodes.add(edge.sourceId);
      connectedNodes.add(edge.targetId);
    }
    for (const node of nodes) {
      if (!connectedNodes.has(node.id)) {
        warnings.push(
          `Node "${node.id}" is not connected to any other node.`
        );
      }
    }
  }

  return { valid: errors.length === 0, estimatedCredits, errors, warnings };
}

// ── 3. autoLayoutNodes — left-to-right topological layout ──────────────────

export function autoLayoutNodes(
  nodes: ProposedNode[],
  edges: ProposedEdge[]
): PositionedNode[] {
  // Topological sort (Kahn's) to determine column order
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (adj.has(e.sourceId) && inDegree.has(e.targetId)) {
      adj.get(e.sourceId)!.push(e.targetId);
      inDegree.set(e.targetId, inDegree.get(e.targetId)! + 1);
    }
  }

  const columns: string[][] = [];
  const remaining = new Map(inDegree);

  while (remaining.size > 0) {
    const col: string[] = [];
    for (const [id, deg] of remaining) {
      if (deg === 0) col.push(id);
    }
    if (col.length === 0) break; // cycle — already caught by validateDAG
    columns.push(col);
    for (const id of col) {
      remaining.delete(id);
      for (const neighbor of adj.get(id) ?? []) {
        if (remaining.has(neighbor)) {
          remaining.set(neighbor, remaining.get(neighbor)! - 1);
        }
      }
    }
  }

  const X_GAP = 350;
  const Y_GAP = 250;
  const Y_START = 100;
  const X_START = 100;

  const positionMap = new Map<string, { x: number; y: number }>();
  for (let col = 0; col < columns.length; col++) {
    for (let row = 0; row < columns[col].length; row++) {
      positionMap.set(columns[col][row], {
        x: X_START + col * X_GAP,
        y: Y_START + row * Y_GAP,
      });
    }
  }

  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    config: n.config ?? {},
    position: positionMap.get(n.id) ?? { x: X_START, y: Y_START },
    label: (n.config?.label as string) ?? n.type,
  }));
}

// ── 4. autoWireEdges — resolve missing handles by type compatibility ───────

export function autoWireEdges(
  nodes: ProposedNode[],
  edges: ProposedEdge[]
): { resolved: ResolvedEdge[]; errors: string[] } {
  const resolved: ResolvedEdge[] = [];
  const errors: string[] = [];
  const nodeTypeMap = new Map(nodes.map((n) => [n.id, n.type]));

  for (const edge of edges) {
    const srcType = nodeTypeMap.get(edge.sourceId) ?? "";
    const tgtType = nodeTypeMap.get(edge.targetId) ?? "";
    const sourceConfig = nodeRegistry.get(srcType);
    const targetConfig = nodeRegistry.get(tgtType);

    if (!sourceConfig || !targetConfig) {
      errors.push(
        `Cannot auto-wire: unknown node type for edge ${edge.sourceId} → ${edge.targetId}.`
      );
      continue;
    }

    // If handles are already fully specified, use them directly
    if (edge.sourceHandle && edge.targetHandle) {
      resolved.push({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
      continue;
    }

    // Auto-resolve: find the first compatible output→input pair
    let matched = false;
    for (const output of sourceConfig.outputs) {
      if (edge.sourceHandle && edge.sourceHandle !== output.key) continue;
      for (const input of targetConfig.inputs) {
        if (edge.targetHandle && edge.targetHandle !== input.key) continue;
        if (
          nodeRegistry.isValidConnection(
            sourceConfig.id,
            output.key,
            targetConfig.id,
            input.key
          )
        ) {
          resolved.push({
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            sourceHandle: edge.sourceHandle ?? output.key,
            targetHandle: edge.targetHandle ?? input.key,
          });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched) {
      errors.push(
        `Cannot auto-wire edge ${edge.sourceId} (${srcType}) → ${edge.targetId} (${tgtType}): no compatible output→input pair. Specify sourceHandle and targetHandle explicitly.`
      );
    }
  }

  return { resolved, errors };
}

// ── 5. scaffoldWorkflow — validate, wire, layout, persist ──────────────────

export async function scaffoldWorkflow(
  userId: string,
  name: string,
  nodes: ProposedNode[],
  edges: ProposedEdge[],
  description?: string
): Promise<{
  workflowId: string;
  workflowName: string;
  nodeCount: number;
  edgeCount: number;
  estimatedCredits: number;
}> {
  // Step 1: Validate the DAG
  const report = validateDAG(nodes, edges);
  if (!report.valid) {
    throw new Error(
      `Workflow validation failed:\n${report.errors.join("\n")}`
    );
  }

  // Step 2: Auto-wire edges
  const { resolved: wiredEdges, errors: wireErrors } = autoWireEdges(
    nodes,
    edges
  );
  if (wireErrors.length > 0) {
    throw new Error(`Auto-wiring failed:\n${wireErrors.join("\n")}`);
  }

  // Step 3: Auto-layout nodes
  const positioned = autoLayoutNodes(nodes, edges);

  // Step 4: Ensure user exists
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });

  // Step 5: Build React Flow compatible data structures
  const flowNodes = positioned.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { type: n.type, label: n.label, ...n.config },
  }));

  const flowEdges = wiredEdges.map((e, i) => ({
    id: `e-${e.sourceId}-${e.targetId}-${Date.now() + i}`,
    source: e.sourceId,
    sourceHandle: e.sourceHandle,
    target: e.targetId,
    targetHandle: e.targetHandle,
  }));

  // Step 6: Persist
  const workflow = await prisma.workflow.create({
    data: {
      userId,
      name,
      description: description ?? null,
      nodes: flowNodes as any,
      edges: flowEdges as any,
    },
  });

  return {
    workflowId: workflow.id,
    workflowName: workflow.name,
    nodeCount: flowNodes.length,
    edgeCount: flowEdges.length,
    estimatedCredits: report.estimatedCredits,
  };
}
