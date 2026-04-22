# Smart MCP Builder Suite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 3 new MCP tools (`list_node_types`, `simulate_workflow`, `scaffold_workflow`) that let AI agents discover nodes, dry-run validation, and one-shot deploy full workflows — without hallucinating IDs, coordinates, or handles.

**Architecture:** A new `lib/services/mcp-builder-service.ts` holds all pure logic (DAG validation, auto-wiring, auto-layout, credit estimation). The MCP route (`app/api/mcp/route.ts`) registers 3 thin tools that call into this service. The existing `nodeRegistry`, `workflow-service`, `node-service`, and `edge-service` are reused — no changes to them.

**Tech Stack:** TypeScript, Zod, Prisma, mcp-handler, existing `nodeRegistry` singleton

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/services/mcp-builder-service.ts` | **Create** | All smart-builder logic: `listNodeTypes()`, `validateDAG()`, `autoWireEdges()`, `autoLayoutNodes()`, `scaffoldWorkflow()` |
| `app/api/mcp/route.ts` | **Modify** (~lines 320-393) | Register 3 new tools before the Resources section |

---

### Task 1: `listNodeTypes` — Discovery Tool

**Goal:** Convert the passive `nextflow://node-types` resource into an active tool so agents can query by category.

**Files:**
- Create: `lib/services/mcp-builder-service.ts` (start with just this one function)
- Modify: `app/api/mcp/route.ts` (add tool registration after tool #9)

- [ ] **Step 1: Create the service file with `listNodeTypes`**

Create `lib/services/mcp-builder-service.ts`:

```ts
// ============================================================================
// lib/services/mcp-builder-service.ts — Smart Builder Service Layer
// ============================================================================
//
// Pure business logic for the Smart Builder MCP tools:
//   1. listNodeTypes  — discovery
//   2. simulateWorkflow — validation & cost (added in Task 3)
//   3. scaffoldWorkflow — one-shot deploy (added in Task 5)
// ============================================================================

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
```

- [ ] **Step 2: Register the `list_node_types` tool in the MCP route**

In `app/api/mcp/route.ts`, add this import at line 27 (after the edge-service import):

```ts
import { listNodeTypes } from "@/lib/services/mcp-builder-service";
```

Then add this tool registration **before** the `// ════ MCP Resources` comment (around line 320):

```ts
    // ── 10. list_node_types ────────────────────────────────────────────
    server.registerTool(
      "list_node_types",
      {
        title: "List Node Types",
        description:
          "Discover all available node types with their inputs, outputs, credit costs, and config schemas. Use this BEFORE building workflows to know exactly what building blocks exist.",
        inputSchema: {
          category: z
            .enum(["input", "ai", "media", "logic", "utility"])
            .optional()
            .describe("Filter by category. Omit to see all."),
        },
      },
      async ({ category }) => {
        try {
          const types = listNodeTypes(category);
          return ok(types);
        } catch (err) {
          return fail(err);
        }
      }
    );
```

- [ ] **Step 3: Verify manually**

Restart `npm run dev`, then test via MCP client. The tool should return the full list of ~16 node types with their schemas.

- [ ] **Step 4: Commit**

```bash
git add lib/services/mcp-builder-service.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add list_node_types discovery tool"
```

---

### Task 2: DAG Validator Helper

**Goal:** Build a pure `validateDAG()` function that detects cycles, checks for unknown node types, and validates required config fields. Used by both `simulate_workflow` (Task 3) and `scaffold_workflow` (Task 5).

**Files:**
- Modify: `lib/services/mcp-builder-service.ts`

- [ ] **Step 1: Add types and the `validateDAG` function**

Append to `lib/services/mcp-builder-service.ts`:

```ts
// ── Shared Types for Simulate / Scaffold ───────────────────────────────────

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

// ── DAG Validation (pure, no DB) ───────────────────────────────────────────

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
    estimatedCredits += nodeRegistry.estimateCredits(node.type, node.config ?? {});
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
    errors.push("Cycle detected in workflow graph. DAGs cannot contain loops.");
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
      const hasEdge = targetsWithEdge.has(`${node.id}:${input.key}`) ||
                      targetsWithEdge.has(`${node.id}:`);
      const hasValue = node.config?.[input.key] !== undefined &&
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
        warnings.push(`Node "${node.id}" is not connected to any other node.`);
      }
    }
  }

  return { valid: errors.length === 0, estimatedCredits, errors, warnings };
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/services/mcp-builder-service.ts
git commit -m "feat(builder): add validateDAG helper with cycle detection"
```

---

### Task 3: `simulate_workflow` — Validation & Cost Tool

**Goal:** Register the MCP tool that calls `validateDAG` so agents can dry-run before committing.

**Files:**
- Modify: `app/api/mcp/route.ts` (add tool #11 after `list_node_types`)

- [ ] **Step 1: Update the import**

In `app/api/mcp/route.ts`, update the import from `mcp-builder-service`:

```ts
import { listNodeTypes, validateDAG } from "@/lib/services/mcp-builder-service";
```

- [ ] **Step 2: Register the `simulate_workflow` tool**

Add after the `list_node_types` registration:

```ts
    // ── 11. simulate_workflow ──────────────────────────────────────────
    server.registerTool(
      "simulate_workflow",
      {
        title: "Simulate Workflow",
        description:
          "Dry-run a proposed workflow to validate the DAG, check for cycles, estimate credit cost, and catch missing inputs — all without saving anything. Call this BEFORE scaffold_workflow.",
        inputSchema: {
          nodes: z.array(
            z.object({
              id: z.string(),
              type: z.string(),
              config: z.record(z.string(), z.unknown()).optional(),
            })
          ),
          edges: z.array(
            z.object({
              sourceId: z.string(),
              targetId: z.string(),
              sourceHandle: z.string().optional(),
              targetHandle: z.string().optional(),
            })
          ),
        },
      },
      async ({ nodes, edges }) => {
        try {
          const report = validateDAG(nodes, edges);
          return ok(report);
        } catch (err) {
          return fail(err);
        }
      }
    );
```

- [ ] **Step 3: Commit**

```bash
git add app/api/mcp/route.ts
git commit -m "feat(mcp): add simulate_workflow dry-run tool"
```

---

### Task 4: Auto-Wiring & Auto-Layout Engine

**Goal:** Build `autoWireEdges()` and `autoLayoutNodes()` helpers the scaffold tool uses to fill in missing handles and compute positions.

**Files:**
- Modify: `lib/services/mcp-builder-service.ts`

- [ ] **Step 1: Add auto-layout function**

Append to `lib/services/mcp-builder-service.ts`:

```ts
// ── Auto-Layout — assigns X/Y positions in a left-to-right flow ────────────

interface PositionedNode {
  id: string;
  type: string;
  config: Record<string, unknown>;
  position: { x: number; y: number };
  label: string;
}

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
```

- [ ] **Step 2: Add auto-wire function**

Append to `lib/services/mcp-builder-service.ts`:

```ts
// ── Auto-Wiring — resolves missing handles by type compatibility ───────────

export interface ResolvedEdge {
  sourceId: string;
  targetId: string;
  sourceHandle: string;
  targetHandle: string;
}

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

    // If handles are already specified, use them directly
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
            sourceConfig.id, output.key,
            targetConfig.id, input.key
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
```

- [ ] **Step 3: Commit**

```bash
git add lib/services/mcp-builder-service.ts
git commit -m "feat(builder): add auto-layout and auto-wiring engines"
```

---

### Task 5: `scaffold_workflow` — One-Shot Deploy Tool

**Goal:** Register the MCP tool that validates, auto-wires, auto-layouts, and persists a complete workflow in one call.

**Files:**
- Modify: `lib/services/mcp-builder-service.ts` (add `scaffoldWorkflow` function + prisma import)
- Modify: `app/api/mcp/route.ts` (add tool #12)

- [ ] **Step 1: Add prisma import and `scaffoldWorkflow` to the service**

At the top of `lib/services/mcp-builder-service.ts`, add alongside the existing imports:

```ts
import { prisma } from "@/lib/db";
```

Then append to the bottom of the file:

```ts
// ── 3. scaffoldWorkflow — validate, wire, layout, persist ──────────────────

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
    throw new Error(`Workflow validation failed:\n${report.errors.join("\n")}`);
  }

  // Step 2: Auto-wire edges
  const { resolved: wiredEdges, errors: wireErrors } = autoWireEdges(nodes, edges);
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
```

- [ ] **Step 2: Register the `scaffold_workflow` tool in the MCP route**

Update the import in `app/api/mcp/route.ts`:

```ts
import {
  listNodeTypes,
  validateDAG,
  scaffoldWorkflow,
} from "@/lib/services/mcp-builder-service";
```

Add after the `simulate_workflow` tool:

```ts
    // ── 12. scaffold_workflow ──────────────────────────────────────────
    server.registerTool(
      "scaffold_workflow",
      {
        title: "Scaffold Workflow",
        description:
          "One-shot deploy: validates the DAG, auto-wires handles, auto-layouts positions, and saves. Use list_node_types first to discover types, then simulate_workflow to dry-run, then this to deploy.",
        inputSchema: {
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          nodes: z.array(
            z.object({
              id: z.string(),
              type: z.string(),
              config: z.record(z.string(), z.unknown()).optional(),
            })
          ),
          edges: z.array(
            z.object({
              sourceId: z.string(),
              targetId: z.string(),
              sourceHandle: z.string().optional(),
              targetHandle: z.string().optional(),
            })
          ),
        },
      },
      async ({ name, description, nodes, edges }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await scaffoldWorkflow(userId, name, nodes, edges, description);
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );
```

- [ ] **Step 3: Verify end-to-end**

Test the full agent flow:
1. `list_node_types` → see all ~16 node types with schemas
2. `simulate_workflow` with a valid graph → `valid: true` + credits
3. `simulate_workflow` with a cycle → `valid: false` + cycle error
4. `scaffold_workflow` → get `workflowId` back
5. `list_workflows` → new workflow appears

- [ ] **Step 4: Commit**

```bash
git add lib/services/mcp-builder-service.ts app/api/mcp/route.ts
git commit -m "feat(mcp): add scaffold_workflow one-shot deploy tool"
```
