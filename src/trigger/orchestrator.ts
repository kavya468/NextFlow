// Execute a saved graph; recovery reuses confirmed outputs and never replays unresolved work.
import { logger, task, batch, metadata } from "@trigger.dev/sdk";
import { Prisma } from "@prisma/client";
import { publicFetch } from "../../lib/safe-fetch";
import { prisma } from "../../lib/db";
import { nodeRegistry } from "../../lib/nodes/registry";
import { ExecutionReservationError, validateExecutionBudget } from "../../lib/credits/billing-policy";
import { recordNodeResult, finalizeRun } from "../../lib/credits/credit-service";
import { ValidationError } from "../../lib/services/errors";
import { readExecutionSnapshot, nodeRecoveryTag, executionOutcome } from "../../lib/services/execution-state";
import { resolveNodeInputs, mapAndValidateNodeOutput, normalizeExecutionEdges } from "../../lib/services/node-inputs";
import "../../lib/nodes/configs";

export const orchestrateWorkflow = task({
  machine: { preset: "large-2x" },
  id: "orchestrate-workflow",
  queue: { name: "workflow-execution", concurrencyLimit: 20 },
  retry: { maxAttempts: 1 },
  run: async (identity: { runId: string; userId: string; recoveryAttempt?: number }, { ctx }) => {
    const { runId, userId } = identity;
    const storedRun = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Run" WHERE id = ${runId} FOR UPDATE`;
      const current = await tx.run.findUnique({ where: { id: runId } });
      if (!current || current.userId !== userId || current.accountingVersion !== 1) throw new Error("Run contract or owner does not match");
      if (current.workerId || current.recoveryAttempt !== (identity.recoveryAttempt ?? 0) || !["PENDING", "DISPATCH_UNKNOWN"].includes(current.status)) return null;
      return tx.run.update({ where: { id: runId }, data: { status: "RUNNING", workerId: ctx.run.id, triggerId: ctx.run.id, dispatchError: null } });
    });
    if (!storedRun) return { skipped: true };
    const executionStart = storedRun.createdAt.getTime();
    let payload: ReturnType<typeof readExecutionSnapshot> | undefined;
    const states: Record<string, string> = {};
    const outputs = new Map<string, Record<string, unknown>>();
    const emit = (nodeId: string, status: string) => {
      states[nodeId] = status;
      // Outputs remain in the database; broadcasting complete media/prompt data is unbounded.
      metadata.set("nodeStatuses", { ...states });
    };

    try {
      payload = readExecutionSnapshot(storedRun.graphSnapshot);
      const { nodes } = payload;
      const edges = normalizeExecutionEdges(nodes, payload.edges);
      for (const node of nodes) {
        const config = nodeRegistry.get(node.type);
        if (!config || payload.nodeVersions[node.id] !== config.version) throw new Error("Node definition changed since this run was prepared; start a new run");
        const quote = payload.estimates.perNode.find(item => item.nodeId === node.id);
        if (!quote || quote.estimate < config.credits.estimate(node.data)) throw new ExecutionReservationError("Node has no sufficient prepared budget");
      }
      const savedNodes = await prisma.nodeRun.findMany({ where: { runId } });
      if (savedNodes.length !== nodes.length || new Set(savedNodes.map(node => node.nodeId)).size !== nodes.length) throw new Error("Saved node executions do not match the graph");
      for (const saved of savedNodes) {
        states[saved.nodeId] = saved.status;
        if (saved.status === "RUNNING") throw new Error("Unresolved node execution must be reconciled before resuming");
        if (saved.status === "SUCCESS") {
          if (!saved.outputs || typeof saved.outputs !== "object" || Array.isArray(saved.outputs)) throw new Error("Confirmed node output is missing");
          outputs.set(saved.nodeId, saved.outputs as Record<string, unknown>);
        }
      }

      const indegree = new Map(nodes.map(node => [node.id, 0]));
      for (const edge of edges) {
        if (!indegree.has(edge.source) || !indegree.has(edge.target)) throw new Error("Saved edge references a missing node");
        indegree.set(edge.target, indegree.get(edge.target)! + 1);
      }
      let ready = nodes.filter(node => indegree.get(node.id) === 0).map(node => node.id);
      const layers: string[][] = [];
      while (ready.length) {
        layers.push(ready);
        const next: string[] = [];
        for (const nodeId of ready) for (const edge of edges.filter(edge => edge.source === nodeId)) {
          indegree.set(edge.target, indegree.get(edge.target)! - 1);
          if (indegree.get(edge.target) === 0) next.push(edge.target);
        }
        ready = next;
      }
      if (layers.flat().length !== nodes.length) throw new Error("Invalid cyclic graph");

      for (const layer of layers) {
        const current = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
        if (current.settledAt) return;
        if (current.status === "CANCEL_REQUESTED") break;
        const jobs: Array<{ nodeId: string; nodeType: string; startedAt: number; inputs: Record<string, unknown>; taskId: string; endpointId: string; providerId: string; payload: Record<string, unknown> }> = [];
        for (const nodeId of layer) {
          if (states[nodeId] !== "PENDING") continue;
          const node = nodes.find(node => node.id === nodeId)!;
          const incoming = edges.filter(edge => edge.target === nodeId);
          if (incoming.some(edge => ["PENDING", "RUNNING"].includes(states[edge.source]))) continue;
          const blockedBy = [...new Set(incoming.filter(edge => states[edge.source] !== "SUCCESS").map(edge => edge.source))];
          if (blockedBy.length) {
            await failNode(userId, runId, nodeId, "BLOCKED", `Blocked by unsuccessful dependencies: ${blockedBy.join(", ")}`);
            emit(nodeId, "BLOCKED");
            continue;
          }
          const startedAt = Date.now();
          let inputs: Record<string, unknown>;
          try {
            inputs = resolveNodeInputs(node, incoming, outputs, payload.inputValues);
            validateExecutionBudget(node.type, inputs, payload.estimates.perNode.find(quote => quote.nodeId === nodeId)!.estimate);
          } catch (error) {
            if (!(error instanceof ValidationError) || error instanceof ExecutionReservationError) throw error;
            await failNode(userId, runId, nodeId, "FAILED", error.message);
            emit(nodeId, "FAILED");
            continue;
          }
          const passthrough = nodeRegistry.resolvePassthrough(node.type, inputs);
          if (passthrough !== null) {
            await recordNodeResult(userId, runId, nodeId, { inputs, outputs: passthrough, creditsUsed: 0, durationMs: Date.now() - startedAt });
            outputs.set(nodeId, passthrough);
            emit(nodeId, "SUCCESS");
            continue;
          }
          const resolved = nodeRegistry.resolveEndpoint(node.type, inputs);
          if (!resolved) {
            await failNode(userId, runId, nodeId, "FAILED", `No provider endpoint is configured for ${node.type}`);
            emit(nodeId, "FAILED");
            continue;
          }
          jobs.push({ nodeId, nodeType: node.type, startedAt, inputs, ...resolved });
        }
        if (!jobs.length) continue;
        const admitted = await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "Run" WHERE id = ${runId} FOR UPDATE`;
          const current = await tx.run.findUniqueOrThrow({ where: { id: runId } });
          if (current.status !== "RUNNING" || current.settledAt || current.workerId !== ctx.run.id) return false;
          for (const job of jobs) {
            const updated = await tx.nodeRun.updateMany({ where: { runId, nodeId: job.nodeId, status: "PENDING" }, data: {
              status: "RUNNING", inputs: json(job.inputs), taskId: job.taskId, endpointId: job.endpointId, providerUsed: job.providerId,
            } });
            if (updated.count !== 1) throw new Error("Node admission is not unique");
          }
          return true;
        });
        if (!admitted) break;
        for (const job of jobs) emit(job.nodeId, "RUNNING");
        const result = await batch.triggerAndWait(jobs.map(job => ({ id: job.taskId, payload: job.payload, options: {
          idempotencyKey: `nextflow:${runId}:${job.nodeId}`, idempotencyKeyTTL: "30d", tags: [nodeRecoveryTag(runId, job.nodeId)],
        } })));
        if (result.runs.length !== jobs.length) throw new Error("The child result list is incomplete; retain the reservation for recovery");
        for (const [index, job] of jobs.entries()) {
          const child = result.runs[index];
          if (child.id) await prisma.nodeRun.updateMany({ where: { runId, nodeId: job.nodeId, status: "RUNNING" }, data: { triggerId: child.id } });
          if (!child.ok) {
            if (payload.estimates.perNode.find(quote => quote.nodeId === job.nodeId)!.estimate > 0) {
              await prisma.nodeRun.updateMany({ where: { runId, nodeId: job.nodeId, status: "RUNNING" }, data: { error: "Provider outcome is unconfirmed. Recovery will check before releasing the hold." } });
              continue;
            }
            await failNode(userId, runId, job.nodeId, "FAILED", "Provider task failed; dependent steps were not run");
            emit(job.nodeId, "FAILED");
            continue;
          }
          const mapped = mapAndValidateNodeOutput(job.nodeType, job.endpointId, child.output);
          const creditsUsed = nodeRegistry.calculateCredits(job.nodeType, job.inputs, child.output);
          await recordNodeResult(userId, runId, job.nodeId, { inputs: job.inputs, outputs: mapped, providerUsed: job.providerId, creditsUsed, durationMs: Date.now() - job.startedAt });
          outputs.set(job.nodeId, mapped);
          emit(job.nodeId, "SUCCESS");
        }
      }
      const current = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { nodeRuns: true } });
      if (current.nodeRuns.some(node => node.status === "RUNNING")) throw new Error("Provider outcomes need reconciliation before settlement");
      const status = executionOutcome(current.nodeRuns.map(node => node.status), current.status === "CANCEL_REQUESTED");
      await finalizeRun(userId, runId, status, { terminalNodeStatus: status === "CANCELLED" ? "CANCELLED" : "FAILED", durationMs: Date.now() - executionStart });
      metadata.set("runStatus", status);
      await notify(payload.webhookUrl, runId, status, Object.fromEntries(outputs));
    } catch (error) {
      const current = await prisma.run.findUniqueOrThrow({ where: { id: runId }, include: { nodeRuns: true } });
      if (current.nodeRuns.some(node => node.status === "RUNNING")) {
        await prisma.run.updateMany({ where: { id: runId, settledAt: null }, data: { dispatchError: "Execution needs reconciliation. Check recovery to confirm provider results before continuing." } });
      } else if (!current.settledAt) {
        const outcome = executionOutcome(current.nodeRuns.map(node => node.status), current.status === "CANCEL_REQUESTED");
        const status = outcome === "SUCCESS" ? "FAILED" : outcome;
        await finalizeRun(userId, runId, status, { terminalNodeStatus: status === "CANCELLED" ? "CANCELLED" : "FAILED", durationMs: Date.now() - executionStart, error: "Execution stopped" });
        metadata.set("runStatus", status);
        await notify(payload?.webhookUrl, runId, status, Object.fromEntries(outputs));
      }
      throw error;
    }
  },
});

function json(value: Record<string, unknown>) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function failNode(userId: string, runId: string, nodeId: string, status: "FAILED" | "BLOCKED", error: string) {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "Run" WHERE id = ${runId} FOR UPDATE`;
    const run = await tx.run.findUniqueOrThrow({ where: { id: runId } });
    if (run.settledAt) return;
    await tx.nodeRun.updateMany({ where: { runId, nodeId, status: { in: ["PENDING", "RUNNING"] } }, data: { status, error } });
  });
}

async function notify(url: string | undefined, runId: string, status: string, outputs: Record<string, unknown>) {
  if (!url) return;
  try {
    await publicFetch(url, { maxBytes: 64 * 1024, timeoutMs: 10_000, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: status === "SUCCESS" ? "run.completed" : "run.failed", runId, status, outputs }) });
  } catch {
    logger.warn("Run settled but its callback could not be delivered", { runId });
  }
}
