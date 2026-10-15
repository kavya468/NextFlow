import { runs } from "@trigger.dev/sdk";
import { prisma } from "../db";
import { nodeRegistry } from "../nodes/registry";
import { finalizeRun, recordNodeResult } from "../credits/credit-service";
import { ExecutionNotFoundError, ValidationError } from "./errors";
import { readExecutionSnapshot, nodeRecoveryTag, executionOutcome } from "./execution-state";
import { mapAndValidateNodeOutput } from "./node-inputs";
import { dispatchRun } from "./workflow-service";

const stoppedWorkerStatuses = new Set(["COMPLETED", "FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"]);

/** Reconcile evidence first. Only an ended worker with no unresolved work can be replaced. */
export async function recoverRun(userId: string, runId: string) {
  const run = await prisma.run.findUnique({ where: { id: runId }, include: { nodeRuns: true } });
  if (!run || run.userId !== userId) throw new ExecutionNotFoundError(runId);
  if (run.settledAt) return { outcome: "settled" as const, status: run.status };
  if (run.accountingVersion !== 1) throw new ValidationError("Legacy accounting requires manual reconciliation");
  if (!run.workerId) {
    if (run.status === "CANCEL_REQUESTED") {
      const result = await finalizeRun(userId, runId, "CANCELLED", { terminalNodeStatus: "CANCELLED", requireUnclaimed: true });
      return { outcome: "settled" as const, status: result.status };
    }
    const result = await dispatchRun(run);
    return { outcome: "dispatch" as const, status: result.status };
  }
  const snapshot = readExecutionSnapshot(run.graphSnapshot);
  if (snapshot.contractVersion < 2 && run.nodeRuns.some(node => node.status === "RUNNING")) {
    return { outcome: "manual_review" as const, status: run.status };
  }

  let parent;
  try { parent = await runs.retrieve(run.workerId); }
  catch { return { outcome: "unavailable" as const, status: run.status }; }
  if (parent.id !== run.workerId || parent.taskIdentifier !== "orchestrate-workflow") throw new ValidationError("Worker identity does not match this execution");
  if (!stoppedWorkerStatuses.has(parent.status)) return { outcome: "active" as const, status: run.status };

  for (const node of run.nodeRuns.filter(node => node.status === "RUNNING").slice(0, 20)) {
    const config = nodeRegistry.get(node.nodeType);
    if (!config || config.version !== snapshot.nodeVersions[node.nodeId] || !node.taskId || !node.endpointId || !node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
      return { outcome: "manual_review" as const, status: run.status };
    }
    const tag = nodeRecoveryTag(runId, node.nodeId);
    let child;
    try {
      if (node.triggerId) child = await runs.retrieve(node.triggerId);
      else {
        const candidates = await runs.list({ tag, limit: 2 });
        if (candidates.data.length !== 1) continue;
        child = await runs.retrieve(candidates.data[0].id);
      }
    } catch { continue; }
    // Tags are only a discovery aid; verify the worker relationship and task before using output.
    if (child.taskIdentifier !== node.taskId || !child.tags.includes(tag) || child.relatedRuns.parent?.id !== run.workerId) continue;
    await prisma.nodeRun.updateMany({ where: { id: node.id, status: "RUNNING" }, data: { triggerId: child.id } });
    if (child.status === "COMPLETED") {
      try {
        const outputs = mapAndValidateNodeOutput(node.nodeType, node.endpointId, child.output);
        const inputs = node.inputs as Record<string, unknown>;
        const creditsUsed = nodeRegistry.calculateCredits(node.nodeType, inputs, child.output);
        await recordNodeResult(userId, runId, node.nodeId, { inputs, outputs, creditsUsed, providerUsed: node.providerUsed ?? undefined, durationMs: child.durationMs });
      } catch { continue; }
    } else if ((child.status === "FAILED" && (!child.startedAt || snapshot.estimates.perNode.find(quote => quote.nodeId === node.nodeId)?.estimate === 0)) || (child.status === "CANCELED" && !child.startedAt)) {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "Run" WHERE id = ${runId} FOR UPDATE`;
        const current = await tx.run.findUniqueOrThrow({ where: { id: runId } });
        if (!current.settledAt && current.workerId === run.workerId) await tx.nodeRun.updateMany({ where: { id: node.id, status: "RUNNING" }, data: { status: "FAILED", error: "Provider task ended without a successful result" } });
      });
    }
    // A started paid task can throw after provider acceptance; its failure is not proof of zero usage.
  }

  const decision = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Run" WHERE id = ${runId} FOR UPDATE`;
    const current = await tx.run.findUniqueOrThrow({ where: { id: runId }, include: { nodeRuns: true } });
    if (current.settledAt || current.workerId !== run.workerId) return { kind: "changed" as const, run: current };
    if (current.nodeRuns.some(node => node.status === "RUNNING")) {
      await tx.run.update({ where: { id: runId }, data: { dispatchError: "Some provider outcomes are still unconfirmed. The hold is retained; recovery will not repeat them." } });
      return { kind: "unresolved" as const, run: current };
    }
    if (current.status === "CANCEL_REQUESTED" || current.nodeRuns.every(node => node.status !== "PENDING")) return { kind: "settle" as const, run: current };
    const updated = await tx.run.update({ where: { id: runId }, data: { workerId: null, triggerId: null, status: "PENDING", dispatchError: null, recoveryAttempt: { increment: 1 } } });
    return { kind: "resume" as const, run: updated };
  });
  if (decision.kind === "unresolved") return { outcome: "unresolved" as const, status: decision.run.status };
  if (decision.kind === "changed") return { outcome: decision.run.settledAt ? "settled" as const : "active" as const, status: decision.run.status };
  if (decision.kind === "settle") {
    const status = executionOutcome(decision.run.nodeRuns.map(node => node.status), decision.run.status === "CANCEL_REQUESTED");
    await finalizeRun(userId, runId, status, { terminalNodeStatus: status === "CANCELLED" ? "CANCELLED" : "FAILED", durationMs: Date.now() - run.createdAt.getTime() });
    return { outcome: "settled" as const, status };
  }
  const dispatched = await dispatchRun(decision.run);
  return { outcome: "resuming" as const, status: dispatched.status };
}
