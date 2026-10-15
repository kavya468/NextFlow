import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ trigger: vi.fn(), batch: vi.fn(), retrieve: vi.fn(), list: vi.fn(), task: vi.fn(definition => definition) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: sdk.trigger }, runs: { retrieve: sdk.retrieve, list: sdk.list }, task: sdk.task, batch: { triggerAndWait: sdk.batch }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, metadata: { set: vi.fn() } }));
import { prisma } from "@/lib/db";
import { executeWorkflow, dispatchRun, requestRunCancellation } from "@/lib/services/workflow-service";
import { recoverRun } from "@/lib/services/run-recovery";
import { getBalance } from "@/lib/credits/credit-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import { cropConfig } from "@/lib/nodes/configs/crop";
import { nodeRecoveryTag } from "@/lib/services/execution-state";
import "@/src/trigger/orchestrator";

const users: string[] = [];
const source = { id: "source", type: "recovery-paid-crop", position: { x: 0, y: 0 }, data: { image_url: "https://example.com/in.png" } };
const child = { ...source, id: "child", type: "crop", data: { image_url: "https://example.com/stale.png" } };
const edge = { id: "source-child", source: "source", target: "child", sourceHandle: "url", targetHandle: "image_url" };
function assertLocal() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !["5432", "55432"].includes(url.port) || url.pathname !== "/nextflow_test") throw new Error("Isolated nextflow_test on localhost:55432 required");
}
beforeAll(() => { assertLocal(); nodeRegistry.register({ ...cropConfig, id: source.type, credits: { estimate: () => 100, calculate: () => 80 } }); });
beforeEach(() => {
  sdk.trigger.mockReset().mockResolvedValue({ id: "dispatch-worker" });
  sdk.batch.mockReset().mockResolvedValue({ runs: [{ id: "new-child", ok: true, output: { url: "https://example.com/new.png" } }] });
  sdk.retrieve.mockReset(); sdk.list.mockReset().mockResolvedValue({ data: [] });
});
afterAll(async () => {
  assertLocal();
  await prisma.creditLedger.deleteMany({ where: { userId: { in: users } } });
  await prisma.run.deleteMany({ where: { userId: { in: users } } });
  await prisma.workflow.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function fixture(nodes = [source, child], edges = [edge]) {
  const userId = `recovery-${randomUUID()}`; users.push(userId);
  await prisma.user.create({ data: { id: userId } });
  await prisma.creditLedger.create({ data: { userId, delta: 1000, reason: "test:grant" } });
  const workflow = await prisma.workflow.create({ data: { userId, name: "Recovery", nodes, edges } });
  const result = await executeWorkflow(userId, workflow.id);
  return { userId, runId: result.executionId };
}
async function worker(f: { userId: string; runId: string }, attempt = 0, id = "old-worker") {
  const definition = sdk.task.mock.calls.find(([definition]) => definition.id === "orchestrate-workflow")![0];
  return definition.run({ ...f, recoveryAttempt: attempt }, { ctx: { run: { id } } });
}
async function interrupt(f: { userId: string; runId: string }) {
  sdk.batch.mockRejectedValueOnce(new Error("lost connection"));
  await expect(worker(f)).rejects.toThrow("lost connection");
  sdk.trigger.mockClear(); sdk.batch.mockClear();
}
function evidence(f: { runId: string }, status = "COMPLETED", overrides = {}) {
  sdk.retrieve.mockImplementation(async (id: string) => id === "old-worker"
    ? { id, taskIdentifier: "orchestrate-workflow", status: "FAILED" }
    : { id, taskIdentifier: "crop-image", status, startedAt: new Date(), output: { url: "https://example.com/recovered.png" }, tags: [nodeRecoveryTag(f.runId, "source")], relatedRuns: { parent: { id: "old-worker" } }, ...overrides });
  sdk.list.mockResolvedValue({ data: [{ id: "original-child" }] });
}

describe.sequential("recovery and dependency behavior", () => {
  it("uses bounded deterministic tags", () => {
    expect(nodeRecoveryTag("run", "node").length).toBeLessThanOrEqual(64);
    expect(nodeRecoveryTag("run", "node")).toBe(nodeRecoveryTag("run", "node"));
    expect(nodeRecoveryTag("run", "node")).not.toBe(nodeRecoveryTag("run2", "node"));
  });
  it("blocks failed descendants, never uses stale canvas input, and completes independent work", async () => {
    const f = await fixture([{ ...source, type: "crop" }, child, { ...child, id: "grandchild" }, { ...child, id: "independent" }], [edge, { ...edge, id: "child-grandchild", source: "child", target: "grandchild" }]);
    sdk.batch.mockResolvedValueOnce({ runs: [{ id: "bad", ok: false, error: "failed" }, { id: "good", ok: true, output: { url: "https://example.com/good.png" } }] });
    await worker(f);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: f.runId }, include: { nodeRuns: true } });
    expect(Object.fromEntries(run.nodeRuns.map(node => [node.nodeId, node.status]))).toEqual({ source: "FAILED", child: "BLOCKED", grandchild: "BLOCKED", independent: "SUCCESS" });
    expect(sdk.batch).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ status: "PARTIAL", chargedCredits: 0 });
  });
  it("retains started paid task failures and leaves dependent work pending", async () => {
    const f = await fixture();
    sdk.batch.mockResolvedValueOnce({ runs: [{ id: "original-child", ok: false, error: "provider callback timed out" }] });
    await expect(worker(f)).rejects.toThrow("reconciliation");
    evidence(f, "FAILED");
    await expect(recoverRun(f.userId, f.runId)).resolves.toMatchObject({ outcome: "unresolved" });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: f.runId }, include: { nodeRuns: true } });
    expect(run.settledAt).toBeNull(); expect(await getBalance(f.userId)).toBe(900);
    expect(run.nodeRuns.find(node => node.nodeId === "child")?.status).toBe("PENDING");
    expect(sdk.batch).toHaveBeenCalledTimes(1);
  });
  it("checks ownership before querying worker details", async () => {
    const f = await fixture(); await interrupt(f);
    await expect(recoverRun("foreign-user", f.runId)).rejects.toThrow();
    expect(sdk.retrieve).not.toHaveBeenCalled(); expect(sdk.trigger).not.toHaveBeenCalled();
  });
  it("does not replace a live parent or repeat an undiscovered child", async () => {
    const f = await fixture(); await interrupt(f);
    sdk.retrieve.mockResolvedValue({ id: "old-worker", taskIdentifier: "orchestrate-workflow", status: "EXECUTING" });
    expect((await recoverRun(f.userId, f.runId)).outcome).toBe("active");
    sdk.retrieve.mockResolvedValue({ id: "old-worker", taskIdentifier: "orchestrate-workflow", status: "FAILED" });
    expect((await recoverRun(f.userId, f.runId)).outcome).toBe("unresolved");
    expect(sdk.trigger).not.toHaveBeenCalled(); expect(sdk.batch).not.toHaveBeenCalled(); expect(await getBalance(f.userId)).toBe(900);
  });
  it("reconciles once under concurrent recovery and resumes only pending work with recovered output", async () => {
    const f = await fixture(); await interrupt(f); evidence(f);
    await Promise.all([recoverRun(f.userId, f.runId), recoverRun(f.userId, f.runId)]);
    let run = await prisma.run.findUniqueOrThrow({ where: { id: f.runId } });
    expect(run.recoveryAttempt).toBe(1);
    expect(sdk.trigger).toHaveBeenCalledTimes(1);
    expect(sdk.trigger.mock.calls[0][2].idempotencyKey).toBe(`nextflow:run:${f.runId}:recovery:1`);
    await expect(worker(f, 0, "stale-worker")).resolves.toEqual({ skipped: true });
    await worker(f, 1, "resumed-worker");
    expect(sdk.batch).toHaveBeenCalledTimes(1);
    expect(sdk.batch.mock.calls[0][0][0].payload.imageUrl).toBe("https://example.com/recovered.png");
    run = await prisma.run.findUniqueOrThrow({ where: { id: f.runId } });
    expect(run).toMatchObject({ status: "SUCCESS", chargedCredits: 80 });
    expect(await getBalance(f.userId)).toBe(920);
    expect(await prisma.creditLedger.count({ where: { operationKey: `run:${f.runId}:settle` } })).toBe(1);
    expect((await recoverRun(f.userId, f.runId)).outcome).toBe("settled");
  });
  it("settles a cancellation only after recovering confirmed provider usage", async () => {
    const f = await fixture(); await interrupt(f);
    await requestRunCancellation(f.userId, f.runId); evidence(f);
    expect((await recoverRun(f.userId, f.runId)).status).toBe("CANCELLED");
    expect(await getBalance(f.userId)).toBe(920); expect(sdk.trigger).not.toHaveBeenCalled();
  });
  it.each([
    { relatedRuns: { parent: { id: "other-worker" } } },
    { taskIdentifier: "other-task" },
    { tags: [] },
    { output: {} },
  ])("retains the hold when child evidence is unusable: %j", async overrides => {
    const f = await fixture(); await interrupt(f); evidence(f, "COMPLETED", overrides);
    expect((await recoverRun(f.userId, f.runId)).outcome).toBe("unresolved");
    expect(await getBalance(f.userId)).toBe(900); expect(sdk.trigger).not.toHaveBeenCalled();
  });
  it.each([false, true])("does not let an old dispatch acknowledgment change a new recovery generation (reject=%s)", async reject => {
    const f = await fixture();
    const original = await prisma.run.update({ where: { id: f.runId }, data: { triggerId: null } });
    sdk.trigger.mockImplementationOnce(async () => {
      await prisma.run.update({ where: { id: f.runId }, data: { recoveryAttempt: 1, triggerId: "new-generation", status: "PENDING" } });
      if (reject) throw Object.assign(new Error("old rejection"), { status: 400 });
      return { id: "old-generation", publicAccessToken: "old-token" };
    });
    const result = await dispatchRun(original);
    expect(result.triggerId).toBe("new-generation"); expect(result.publicAccessToken).toBeUndefined();
    expect(await prisma.run.findUniqueOrThrow({ where: { id: f.runId } })).toMatchObject({ status: "PENDING", recoveryAttempt: 1, triggerId: "new-generation", settledAt: null });
    expect(await getBalance(f.userId)).toBe(900);
  });
  it("refuses to redispatch beyond the idempotency safety window", async () => {
    const f = await fixture();
    const run = await prisma.run.update({ where: { id: f.runId }, data: { triggerId: null, createdAt: new Date(Date.now() - 30 * 86400_000) } });
    sdk.trigger.mockClear();
    await expect(dispatchRun(run)).rejects.toThrow("safe retry window"); expect(sdk.trigger).not.toHaveBeenCalled();
  });
});
