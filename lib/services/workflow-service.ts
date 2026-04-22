// ============================================================================
// lib/services/workflow-service.ts — Shared Workflow Service Layer
// ============================================================================
//
// Pure business-logic functions consumed by BOTH the tRPC router and the
// HTTP MCP endpoint.  No framework-specific types (TRPCError, etc.) — callers
// catch the domain errors and translate them as needed.
// ============================================================================

import { prisma } from "@/lib/db";
import {
  WorkflowNotFoundError,
  ExecutionNotFoundError,
  ValidationError,
  OwnershipError,
  DuplicateLabelError,
} from "@/lib/services/errors";
import { estimateWorkflowCost, reserveCredits } from "@/lib/credits/credit-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: register all node configs
import { getExposedInputs, deduplicatePassthroughLabels } from "@/lib/nodes/exposed-inputs";
import { tasks } from "@trigger.dev/sdk/v3";

// ── 1. createWorkflow ──────────────────────────────────────────────────────

export async function createWorkflow(
  userId: string,
  name: string,
  description?: string,
) {
  // Ensure the User row exists (Clerk users may not have a DB row yet)
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });

  const workflow = await prisma.workflow.create({
    data: {
      userId,
      name,
      description: description ?? null,
      nodes: [] as any,
      edges: [] as any,
    },
  });

  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    createdAt: workflow.createdAt,
  };
}

// ── 2. listWorkflows ───────────────────────────────────────────────────────

export async function listWorkflows(
  userId: string,
  limit = 20,
  offset = 0,
) {
  const workflows = await prisma.workflow.findMany({
    where: { userId },
    select: {
      id: true,
      name: true,
      description: true,
      nodes: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  return workflows.map((wf) => {
    const nodes = Array.isArray(wf.nodes)
      ? (wf.nodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>)
      : [];

    return {
      id: wf.id,
      name: wf.name,
      description: wf.description,
      nodeCount: nodes.length,
      updatedAt: wf.updatedAt,
      exposedInputs: getExposedInputs(nodes, nodeRegistry).inputs,
    };
  });
}

// ── 3. getWorkflowByName ───────────────────────────────────────────────────

export async function getWorkflowByName(userId: string, name: string) {
  const workflow = await prisma.workflow.findFirst({
    where: {
      userId,
      name: { equals: name, mode: "insensitive" },
    },
  });

  if (!workflow) {
    throw new WorkflowNotFoundError(name);
  }

  return workflow;
}

// ── 4. executeWorkflow ─────────────────────────────────────────────────────

export interface ExecuteWorkflowOptions {
  /** Input value overrides for parameterized runs (label → value map). */
  inputValues?: Record<string, unknown>;
  /** Subset of node IDs to execute (enables PARTIAL / SINGLE scope). */
  selectedNodeIds?: string[];
  /** Override the workflow's stored nodes (e.g. unsaved canvas state). */
  nodesOverride?: any[];
  /** Override the workflow's stored edges (e.g. unsaved canvas state). */
  edgesOverride?: any[];
  /** Skip ownership check — used when a consumer runs a published template. */
  skipOwnershipCheck?: boolean;
  /** Webhook URL to call upon completion. */
  webhookUrl?: string;
}

export async function executeWorkflow(
  userId: string,
  workflowId: string,
  options?: ExecuteWorkflowOptions,
) {
  const {
    inputValues,
    selectedNodeIds,
    nodesOverride,
    edgesOverride,
    skipOwnershipCheck = false,
    webhookUrl,
  } = options ?? {};

  // Ensure the User row exists (Clerk users may not have a DB row yet)
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });

  // Load workflow & verify ownership
  const workflow = await prisma.workflow.findUnique({
    where: { id: workflowId },
  });

  if (!workflow) {
    throw new WorkflowNotFoundError(workflowId);
  }
  if (!skipOwnershipCheck && workflow.userId !== userId) {
    throw new OwnershipError();
  }

  // Use overrides if provided (unsaved canvas / tRPC), else read from DB
  const allNodes = (nodesOverride ?? workflow.nodes) as any[];
  const allEdges = (edgesOverride ?? workflow.edges) as any[];

  // Filter out note nodes — they're visual-only, never executed
  let execNodes = allNodes.filter((n: any) => n.type !== "note");
  let execEdges = allEdges;

  // ── Partial / Single Scope Resolution ─────────────────────────────
  // When selectedNodeIds is provided, gather upstream dependencies via
  // BFS so that all required inputs are executed. This logic was
  // previously duplicated in the tRPC router.
  let scope = "FULL";
  if (selectedNodeIds && selectedNodeIds.length > 0) {
    scope = selectedNodeIds.length === 1 ? "SINGLE" : "PARTIAL";
    const selectedSet = new Set<string>(selectedNodeIds);
    const visited = new Set<string>();

    function gatherUpstream(nodeId: string) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      selectedSet.add(nodeId);
      for (const edge of allEdges) {
        if (edge.target === nodeId) {
          gatherUpstream(edge.source);
        }
      }
    }
    for (const nid of selectedNodeIds) gatherUpstream(nid);

    execNodes = execNodes.filter((n: any) => selectedSet.has(n.id));
    execEdges = allEdges.filter(
      (e: any) => selectedSet.has(e.source) && selectedSet.has(e.target),
    );
  }

  // ── Zero-Trust Node Input Validation ──────────────────────────────
  // Uses .partial() because required fields may be wired from upstream
  // edges at runtime — we only validate the TYPES of values the client
  // actually provided.
  const validationErrors: string[] = [];
  for (const node of execNodes) {
    if (!node.type) {
      validationErrors.push(`Node "${node.id}": missing type`);
      continue;
    }
    if (!nodeRegistry.has(node.type)) {
      validationErrors.push(`Node "${node.id}": unknown type "${node.type}"`);
      continue;
    }
    const schema = nodeRegistry.getInputSchema(node.type);
    const result = schema.partial().safeParse(node.data ?? {});
    if (!result.success) {
      const issues = result.error.issues
        .map((iss: any) => `${iss.path.join(".")}: ${iss.message}`)
        .join("; ");
      validationErrors.push(`Node "${node.id}" (${node.type}): ${issues}`);
    }
  }
  if (validationErrors.length > 0) {
    throw new ValidationError(validationErrors.join("\n"));
  }

  // ── Passthrough Label Uniqueness Validation ───────────────────────
  // If inputValues are provided, duplicate labels would cause the same
  // override to be applied to ALL matching nodes — silent data corruption.
  // Auto-deduplicate before dispatching.
  const labelChanges = deduplicatePassthroughLabels(
    execNodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>,
    nodeRegistry,
  );
  if (labelChanges.length > 0) {
    console.warn(
      `[executeWorkflow] Auto-deduplicated ${labelChanges.length} passthrough labels:`,
      labelChanges.map((c) => `${c.oldLabel} → ${c.newLabel} (${c.nodeId})`),
    );
  }

  // ── Credit Estimation ─────────────────────────────────────────────
  const costEstimate = await estimateWorkflowCost(
    execNodes.map((n: any) => ({
      id: n.id,
      type: n.type || "unknown",
      data: n.data ?? {},
    })),
  );
  const estimatedCredits = costEstimate.total;

  // ── Create Run record (needed for reservation FK) ─────────────────
  const startTime = Date.now();
  const run = await prisma.run.create({
    data: {
      userId,
      workflowId,
      scope,
      status: "RUNNING",
      inputValues: (inputValues ?? undefined) as any,
    },
  });

  // ── Atomic Credit Reservation (block-on-estimate with FOR UPDATE) ─
  // This serializes concurrent credit checks per-user, preventing
  // overdraft when multiple runs fire simultaneously.
  if (estimatedCredits > 0) {
    try {
      await reserveCredits(userId, run.id, estimatedCredits);
    } catch (err) {
      // Clean up the Run record if reservation fails
      await prisma.run.delete({ where: { id: run.id } });
      throw err;
    }
  }

  // ── Batch-create NodeRun records (single DB write) ────────────────
  await prisma.nodeRun.createMany({
    data: execNodes.map((node: any) => ({
      runId: run.id,
      nodeId: node.id,
      nodeType: node.type || "unknown",
      status: "PENDING",
    })),
  });

  // ── Dispatch to Trigger.dev ───────────────────────────────────────
  const handle = await tasks.trigger<any>("orchestrate-workflow", {
    runId: run.id,
    userId,
    nodes: execNodes,
    edges: execEdges,
    startTime,
    inputValues,
    reservedCredits: estimatedCredits, // For settlement after completion
    webhookUrl,
  }, {
    tags: [`run:${run.id}`],
    queue: "workflow-execution", // Must match the queue name in orchestrator.ts task definition
  });

  await prisma.run.update({
    where: { id: run.id },
    data: { triggerId: handle.id },
  });

  return {
    executionId: run.id,
    triggerId: handle.id,
    status: "triggered" as const,
    workflowId,
    estimatedCredits,
    scope,
    nodeCount: execNodes.length,
    // Actual nodes dispatched (from DB state) — lets callers verify correctness
    executedNodes: execNodes.map((n: any) => ({
      id: n.id,
      type: n.type,
      label: n.data?.label ?? n.type,
    })),
    // Trigger.dev SDK v4 may return a publicAccessToken on the handle
    publicAccessToken: (handle as any).publicAccessToken as string | undefined,
  };
}

// ── 5. getExecutionStatus ──────────────────────────────────────────────────

export async function getExecutionStatus(
  userId: string,
  executionId: string,
) {
  let run;

  if (executionId === "latest") {
    // Find the most recent run for this user
    run = await prisma.run.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      include: {
        nodeRuns: { orderBy: { createdAt: "asc" } },
      },
    });
  } else {
    run = await prisma.run.findUnique({
      where: { id: executionId },
      include: {
        nodeRuns: { orderBy: { createdAt: "asc" } },
      },
    });
  }

  if (!run) {
    throw new ExecutionNotFoundError(executionId);
  }
  if (run.userId !== userId) {
    throw new OwnershipError();
  }

  // Build outputs map: nodeId → output data
  const result: Record<string, unknown> = {};
  const logs: string[] = [];

  for (const nr of run.nodeRuns) {
    if (nr.outputs) {
      result[nr.nodeId] = nr.outputs;
    }
    if (nr.error) {
      logs.push(`[${nr.nodeType}/${nr.nodeId}] ERROR: ${nr.error}`);
    }
    if (nr.status === "COMPLETED") {
      logs.push(`[${nr.nodeType}/${nr.nodeId}] completed`);
    }
  }

  return {
    executionId: run.id,
    status: run.status,
    result,
    error: run.nodeRuns.find((nr) => nr.error)?.error ?? null,
    logs,
    startedAt: run.createdAt,
    completedAt: run.completedAt ?? null,
  };
}

// ── 6. cloneWorkflow ───────────────────────────────────────────────────────

export async function cloneWorkflow(userId: string, sourceWorkflowId: string) {
  const source = await prisma.workflow.findUnique({
    where: { id: sourceWorkflowId },
  });

  if (!source) {
    throw new WorkflowNotFoundError(sourceWorkflowId);
  }

  if (source.visibility !== "published") {
    throw new ValidationError("Only published workflows can be cloned");
  }

  // Ensure the User row exists (Clerk users may not have a DB row yet)
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId },
  });

  const clone = await prisma.workflow.create({
    data: {
      userId,
      name: `${source.name} (copy)`,
      description: source.description,
      nodes: source.nodes as any,
      edges: source.edges as any,
      // Private copy — user can later publish it as their own
      visibility: "private",
    },
  });

  return clone;
}
