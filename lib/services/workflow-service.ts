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
  WorkflowConflictError,
} from "@/lib/services/errors";
import { estimateWorkflowCost, reserveCredits, finalizeRun } from "@/lib/credits/credit-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: register all node configs
import { getExposedInputs } from "@/lib/nodes/exposed-inputs";
import { tasks } from "@trigger.dev/sdk";
import { Prisma, type Run } from "@prisma/client";
import { createHash } from "node:crypto";
import { prepareExecutionGraph } from "./execution-graph";

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
      nodes: [],
      edges: [],
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
  inputValues?: Record<string, unknown>;
  selectedNodeIds?: string[];
  nodesOverride?: unknown[];
  edgesOverride?: unknown[];
  skipOwnershipCheck?: boolean;
  webhookUrl?: string;
  requestKey?: string;
  saveCanvas?: boolean;
  expectedRevision?: number;
}

type RunSnapshot = ReturnType<typeof prepareExecutionGraph> & {
  estimates: Awaited<ReturnType<typeof estimateWorkflowCost>>;
  inputValues?: Record<string, unknown>;
  webhookUrl?: string;
  contractVersion: number;
  nodeVersions: Record<string, string>;
  providers: Record<string, Array<{ id: string; endpoints: Array<{ id: string; taskId: string }> }>>;
};

function requestFingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, canonical(val)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export async function executeWorkflow(userId: string, workflowId: string, options: ExecuteWorkflowOptions = {}) {
  const { requestKey, ...request } = options;
  if (requestKey !== undefined && (!requestKey.length || requestKey.length > 128)) throw new ValidationError("Idempotency key must contain 1–128 characters");
  const requestHash = requestFingerprint({ workflowId, ...request });
  await prisma.user.upsert({ where: { id: userId }, create: { id: userId }, update: {} });

  const run = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    if (requestKey) {
      const existing = await tx.run.findUnique({ where: { userId_requestKey: { userId, requestKey } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ValidationError("This idempotency key belongs to a different execution request");
        return existing;
      }
    }
    if (workflowId) await tx.$queryRaw`SELECT "id" FROM "Workflow" WHERE "id" = ${workflowId} FOR UPDATE`;
    let workflow = workflowId ? await tx.workflow.findUnique({ where: { id: workflowId } }) : null;
    if (!workflow && workflowId) throw new WorkflowNotFoundError(workflowId);
    if (workflow && workflow.userId !== userId && !(options.skipOwnershipCheck && workflow.visibility === "published")) throw new OwnershipError();
    if (workflow && options.saveCanvas && options.expectedRevision === undefined) throw new ValidationError("An expected revision is required before saving an existing workflow");
    if (workflow && options.expectedRevision !== undefined && workflow.revision !== options.expectedRevision) throw new WorkflowConflictError();
    if (!workflow) {
      if (!options.saveCanvas || !options.nodesOverride || !options.edgesOverride) throw new WorkflowNotFoundError(workflowId);
      workflow = await tx.workflow.create({ data: { userId, name: "Untitled Workflow", nodes: options.nodesOverride as Prisma.InputJsonValue, edges: options.edgesOverride as Prisma.InputJsonValue } });
    } else if (options.saveCanvas) {
      if (workflow.userId !== userId) throw new OwnershipError();
      workflow = await tx.workflow.update({ where: { id: workflow.id, userId }, data: {
        nodes: options.nodesOverride as Prisma.InputJsonValue,
        edges: options.edgesOverride as Prisma.InputJsonValue,
        revision: { increment: 1 },
      } });
    }
    const graph = prepareExecutionGraph(options.nodesOverride ?? workflow.nodes, options.edgesOverride ?? workflow.edges, options.selectedNodeIds, options.inputValues);
    const estimates = await estimateWorkflowCost(graph.nodes);
    const snapshot: RunSnapshot = {
      ...graph, estimates, inputValues: options.inputValues, webhookUrl: options.webhookUrl, contractVersion: 2,
      nodeVersions: Object.fromEntries(graph.nodes.map(n => [n.id, nodeRegistry.get(n.type)!.version])),
      providers: Object.fromEntries(graph.nodes.map(n => [n.id, nodeRegistry.get(n.type)!.providers.map(p => ({ id: p.id, endpoints: p.endpoints.map(e => ({ id: e.id, taskId: e.taskId })) }))])),
    };
    const prepared = await tx.run.create({ data: {
      workflowId: workflow.id, userId, scope: graph.scope, status: "PENDING",
      accountingVersion: 1, workflowRevision: workflow.revision,
      graphSnapshot: JSON.parse(JSON.stringify(snapshot)),
      inputValues: options.inputValues as Prisma.InputJsonValue | undefined,
      requestKey, requestHash,
    } });
    await reserveCredits(userId, prepared.id, estimates.total, tx);
    await tx.nodeRun.createMany({ data: graph.nodes.map(node => ({ runId: prepared.id, nodeId: node.id, nodeType: node.type, status: "PENDING" })) });
    return tx.run.findUniqueOrThrow({ where: { id: prepared.id } });
  }, { timeout: 15_000 });
  return dispatchRun(run);
}

export async function dispatchRun(run: Run) {
  const snapshot = run.graphSnapshot as unknown as RunSnapshot;
  let triggerId = run.triggerId ?? undefined;
  let publicAccessToken: string | undefined;
  let status = run.status;
  if (!triggerId && ["PENDING", "DISPATCH_UNKNOWN"].includes(status)) {
    // Trigger idempotency has a finite lifetime; never replay an old ambiguous submission.
    if (Date.now() - run.createdAt.getTime() >= 29 * 24 * 60 * 60 * 1000) throw new ValidationError("This run is outside the safe retry window and needs manual review");
    try {
      const handle = await tasks.trigger("orchestrate-workflow", { runId: run.id, userId: run.userId, recoveryAttempt: run.recoveryAttempt }, {
        idempotencyKey: `nextflow:run:${run.id}${run.recoveryAttempt ? `:recovery:${run.recoveryAttempt}` : ""}`, idempotencyKeyTTL: "30d",
        tags: [`run:${run.id}`], queue: "workflow-execution",
      });
      triggerId = handle.id;
      publicAccessToken = (handle as { publicAccessToken?: string }).publicAccessToken;
      await prisma.run.updateMany({ where: { id: run.id, recoveryAttempt: run.recoveryAttempt, settledAt: null }, data: { triggerId, dispatchError: null } });
      await prisma.run.updateMany({ where: { id: run.id, recoveryAttempt: run.recoveryAttempt, status: "DISPATCH_UNKNOWN" }, data: { status: "PENDING" } });
      status = (await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).status;
    } catch (error) {
      const httpStatus = (error as { status?: number })?.status;
      const rejected = [400, 401, 403, 404, 413, 422].includes(httpStatus ?? 0);
      // A lost acknowledgment may hide an accepted job. Keep its reservation and identity.
      await prisma.run.updateMany({ where: { id: run.id, recoveryAttempt: run.recoveryAttempt, status: { in: ["PENDING", "DISPATCH_UNKNOWN"] }, workerId: null }, data: {
        status: "DISPATCH_UNKNOWN", dispatchError: rejected ? "Dispatch rejected" : "Dispatch acknowledgment unavailable",
      } });
      const current = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
      if (rejected && current.recoveryAttempt === run.recoveryAttempt && !current.workerId && !current.settledAt) {
        try {
          const settled = await finalizeRun(run.userId, run.id, "FAILED", { error: "Dispatch rejected before execution", terminalNodeStatus: "FAILED", requireUnclaimed: true, expectedRecoveryAttempt: run.recoveryAttempt });
          status = settled.status;
        } catch {
          status = (await prisma.run.findUniqueOrThrow({ where: { id: run.id } })).status;
        }
      } else status = current.status;
    }
  }
  const latest = await prisma.run.findUniqueOrThrow({ where: { id: run.id } });
  if (latest.recoveryAttempt !== run.recoveryAttempt || latest.triggerId !== triggerId) publicAccessToken = undefined;
  triggerId = latest.triggerId ?? undefined;
  status = latest.status;
  return {
    executionId: run.id, triggerId, publicAccessToken,
    status: triggerId && ["PENDING", "RUNNING"].includes(status) ? "triggered" : status.toLowerCase(),
    workflowId: run.workflowId, estimatedCredits: run.reservedCredits, scope: run.scope,
    nodeCount: snapshot.nodes.length,
    executedNodes: snapshot.nodes.map(n => ({ id: n.id, type: n.type, label: n.data?.label ?? n.type })),
  };
}

export async function retryRunDispatch(userId: string, runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run || run.userId !== userId) throw new ExecutionNotFoundError(runId);
  if (run.accountingVersion !== 1) throw new ValidationError("Legacy runs cannot be redispatched");
  return dispatchRun(run);
}

export async function requestRunCancellation(userId: string, runId: string) {
  const run = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Run" WHERE "id" = ${runId} FOR UPDATE`;
    const current = await tx.run.findUnique({ where: { id: runId } });
    if (!current || current.userId !== userId) throw new ExecutionNotFoundError(runId);
    if (["SUCCESS", "FAILED", "PARTIAL", "CANCELLED"].includes(current.status)) return current;
    if (current.accountingVersion !== 1) throw new ValidationError("Legacy runs require reconciliation before cancellation");
    return tx.run.update({ where: { id: runId }, data: { status: "CANCEL_REQUESTED", cancellationRequestedAt: new Date() } });
  });
  if (run.status === "CANCEL_REQUESTED" && !run.workerId) {
    return finalizeRun(userId, runId, "CANCELLED", { terminalNodeStatus: "CANCELLED", error: "Cancelled before execution" });
  }
  // Let in-flight provider tasks return their usage before releasing the unused reservation.
  return { status: run.status };
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
    if (nr.status === "SUCCESS") {
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
      nodes: source.nodes as Prisma.InputJsonValue,
      edges: source.edges as Prisma.InputJsonValue,
      // Private copy — user can later publish it as their own
      visibility: "private",
    },
  });

  return clone;
}
