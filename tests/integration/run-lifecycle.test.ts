import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const dispatch = vi.hoisted(() => ({ trigger: vi.fn(), batch: vi.fn(), task: vi.fn((definition) => definition) }));
vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: dispatch.trigger }, task: dispatch.task, batch: { triggerAndWait: dispatch.batch }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, metadata: { set: vi.fn() } }));
import { prisma } from "@/lib/db";
import { executeWorkflow, retryRunDispatch, requestRunCancellation } from "@/lib/services/workflow-service";
import { getBalance } from "@/lib/credits/credit-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import { cropConfig } from "@/lib/nodes/configs/crop";
import "@/src/trigger/orchestrator";
import { workflowRouter } from "@/server/trpc/routers/workflow";

const users: string[] = [];
const nodes = [{ id: "paid", type: "credit-test-crop", position: { x: 0, y: 0 }, data: { image_url: "https://example.com/test.png", label: "Source" } }];
function assertLocal() {
  const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/nextflow_test") throw new Error("Local nextflow_test database required");
}
beforeAll(() => { assertLocal(); nodeRegistry.register({ ...cropConfig, id: "credit-test-crop", credits: { estimate: (data) => Number(data.x_percent ?? 100), calculate: () => 80 } }); });
beforeEach(() => { dispatch.trigger.mockReset().mockResolvedValue({ id: "trigger-test" }); dispatch.batch.mockReset().mockResolvedValue({ runs: [{ ok: true, output: { url: "https://example.com/output.png" } }] }); });
afterAll(async () => {
  assertLocal();
  await prisma.creditLedger.deleteMany({ where: { userId: { in: users } } });
  await prisma.run.deleteMany({ where: { userId: { in: users } } });
  await prisma.workflow.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});
async function fixture(balance = 1000) {
  const userId = `lifecycle-${randomUUID()}`; users.push(userId);
  await prisma.user.create({ data: { id: userId } });
  await prisma.creditLedger.create({ data: { userId, delta: balance, reason: "test:grant" } });
  const workflow = await prisma.workflow.create({ data: { userId, name: "Lifecycle test", nodes, edges: [] } });
  return { userId, workflow };
}
async function worker(userId: string, runId: string, workerId = randomUUID()) {
  const definition = dispatch.task.mock.calls.find(([d]) => d.id === "orchestrate-workflow")?.[0];
  return definition.run({ userId, runId }, { ctx: { run: { id: workerId } } });
}

describe.sequential("prepared run lifecycle on PostgreSQL", () => {
  it("rolls back foreign-owner canvas changes before reservation or dispatch", async () => {
    const owner = await fixture(); const attacker = await fixture();
    await expect(executeWorkflow(attacker.userId, owner.workflow.id, { saveCanvas: true, nodesOverride: [], edgesOverride: [] })).rejects.toThrow("access");
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: owner.workflow.id } })).nodes).toEqual(nodes);
    expect(await prisma.run.count({ where: { workflowId: owner.workflow.id } })).toBe(0);
    expect(dispatch.trigger).not.toHaveBeenCalled();
    expect(await getBalance(owner.userId)).toBe(1000);
  });
  it("rejects cycles and unknown selected nodes before saving or reserving", async () => {
    const f = await fixture();
    await expect(executeWorkflow(f.userId, f.workflow.id, { saveCanvas: true, expectedRevision: f.workflow.revision, nodesOverride: nodes, edgesOverride: [{ id: "cycle", source: "paid", target: "paid" }] })).rejects.toThrow("cycle");
    await expect(executeWorkflow(f.userId, f.workflow.id, { selectedNodeIds: ["missing"] })).rejects.toThrow("existing");
    expect(await prisma.run.count({ where: { userId: f.userId } })).toBe(0);
    expect(await getBalance(f.userId)).toBe(1000);
    expect((await prisma.workflow.findUniqueOrThrow({ where: { id: f.workflow.id } })).revision).toBe(0);
  });
  it("resolves overrides before estimating and preserves the saved execution snapshot after edits", async () => {
    const f = await fixture();
    const result = await executeWorkflow(f.userId, f.workflow.id, { inputValues: { "paid.x_percent": 90 } });
    expect(result.estimatedCredits).toBe(90);
    const before = await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } });
    await prisma.workflow.update({ where: { id: f.workflow.id }, data: { nodes: [], revision: { increment: 1 } } });
    expect((await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } })).graphSnapshot).toEqual(before.graphSnapshot);
    expect(before.workflowRevision).toBe(0);
  });
  it("reuses a concurrent request key and rejects a different request using it", async () => {
    const f = await fixture();
    const [a,b] = await Promise.all([executeWorkflow(f.userId, f.workflow.id, { requestKey: "same" }), executeWorkflow(f.userId, f.workflow.id, { requestKey: "same" })]);
    expect(a.executionId).toBe(b.executionId);
    expect(await prisma.run.count({ where: { userId: f.userId } })).toBe(1);
    expect(await getBalance(f.userId)).toBe(900);
    expect(new Set(dispatch.trigger.mock.calls.map(call => call[2].idempotencyKey)).size).toBe(1);
    await expect(executeWorkflow(f.userId, f.workflow.id, { requestKey: "same", inputValues: { "paid.x_percent": 90 } })).rejects.toThrow("different execution");
  });
  it("retains an uncertain dispatch hold and retries its existing identity", async () => {
    const f = await fixture(); dispatch.trigger.mockRejectedValueOnce(new Error("ack lost"));
    const result = await executeWorkflow(f.userId, f.workflow.id);
    expect(result.status).toBe("dispatch_unknown"); expect(await getBalance(f.userId)).toBe(900);
    const retried = await retryRunDispatch(f.userId, result.executionId);
    expect(retried.executionId).toBe(result.executionId);
    expect(dispatch.trigger.mock.calls[0][2].idempotencyKey).toBe(dispatch.trigger.mock.calls[1][2].idempotencyKey);
    expect(await prisma.run.count({ where: { userId: f.userId } })).toBe(1);
  });
  it("releases a definitively rejected no-work dispatch exactly once", async () => {
    const f = await fixture(); dispatch.trigger.mockRejectedValue(Object.assign(new Error("invalid task"), { status: 400 }));
    const result = await executeWorkflow(f.userId, f.workflow.id, { requestKey: "reject" });
    expect(result.status).toBe("failed"); expect(await getBalance(f.userId)).toBe(1000);
    await retryRunDispatch(f.userId, result.executionId);
    expect(dispatch.trigger).toHaveBeenCalledTimes(1);
  });
  it("runs and settles with one debit, skips a duplicate worker, and keeps completion terminal", async () => {
    const f = await fixture(); const result = await executeWorkflow(f.userId, f.workflow.id);
    await worker(f.userId, result.executionId);
    expect(await getBalance(f.userId)).toBe(920);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } })).status).toBe("SUCCESS");
    await expect(worker(f.userId, result.executionId)).resolves.toEqual({ skipped: true });
    expect(dispatch.batch).toHaveBeenCalledTimes(1);
    expect(dispatch.batch.mock.calls[0][0][0].options.idempotencyKey).toContain(result.executionId);
    await expect(requestRunCancellation(f.userId, result.executionId)).resolves.toMatchObject({ status: "SUCCESS" });
    expect(await getBalance(f.userId)).toBe(920);
  });
  it("cancels queued work before worker admission and refunds the whole hold", async () => {
    const f = await fixture(); const result = await executeWorkflow(f.userId, f.workflow.id);
    await expect(requestRunCancellation(f.userId, result.executionId)).resolves.toMatchObject({ status: "CANCELLED" });
    await expect(worker(f.userId, result.executionId)).resolves.toEqual({ skipped: true });
    expect(await getBalance(f.userId)).toBe(1000); expect(dispatch.batch).not.toHaveBeenCalled();
  });
  it("waits for in-flight results after cancellation, then charges only known usage", async () => {
    const f = await fixture(); const result = await executeWorkflow(f.userId, f.workflow.id);
    dispatch.batch.mockImplementationOnce(async () => {
      await expect(requestRunCancellation(f.userId, result.executionId)).resolves.toMatchObject({ status: "CANCEL_REQUESTED" });
      expect(await getBalance(f.userId)).toBe(900);
      return { runs: [{ ok: true, output: { url: "https://example.com/output.png" } }] };
    });
    await worker(f.userId, result.executionId);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } })).status).toBe("CANCELLED");
    expect(await getBalance(f.userId)).toBe(920);
  });
  it("holds unresolved work when the provider acknowledgment is lost", async () => {
    const f = await fixture(); const result = await executeWorkflow(f.userId, f.workflow.id);
    dispatch.batch.mockRejectedValueOnce(new Error("provider ack lost"));
    await expect(worker(f.userId, result.executionId)).rejects.toThrow("provider ack lost");
    expect(await getBalance(f.userId)).toBe(900);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: result.executionId }, include: { nodeRuns: true } });
    expect(run.settledAt).toBeNull(); expect(run.dispatchError).toContain("reconciliation"); expect(run.nodeRuns[0].status).toBe("RUNNING");
  });
  it("releases the hold when graph preparation fails before any child dispatch", async () => {
    const f = await fixture();
    const result = await executeWorkflow(f.userId, f.workflow.id, { nodesOverride: [...nodes, { ...nodes[0], id: "second" }] });
    const original = nodeRegistry.resolveEndpoint.bind(nodeRegistry);
    const resolver = vi.spyOn(nodeRegistry, "resolveEndpoint").mockImplementationOnce(original).mockImplementationOnce(() => { throw new Error("local resolution failed"); });
    try { await expect(worker(f.userId, result.executionId)).rejects.toThrow("local resolution failed"); }
    finally { resolver.mockRestore(); }
    expect(dispatch.batch).not.toHaveBeenCalled();
    expect(await getBalance(f.userId)).toBe(1000);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } })).status).toBe("FAILED");
  });
  it("applies node-ID overrides after label overrides for both estimate and execution", async () => {
    const f = await fixture();
    const result = await executeWorkflow(f.userId, f.workflow.id, { inputValues: { "paid.x_percent": 90, "Source.x_percent": 95 } });
    expect(result.estimatedCredits).toBe(90);
    await worker(f.userId, result.executionId);
    expect(dispatch.batch.mock.calls[0][0][0].payload.x).toBe(90);
    expect(await getBalance(f.userId)).toBe(920);
  });
  it("refuses a changed node definition before provider work and releases its hold", async () => {
    const f = await fixture(); const result = await executeWorkflow(f.userId, f.workflow.id);
    const config = nodeRegistry.get("credit-test-crop")!;
    nodeRegistry.register({ ...config, version: "different" });
    try { await expect(worker(f.userId, result.executionId)).rejects.toThrow("Node definition changed"); }
    finally { nodeRegistry.register(config); }
    expect(dispatch.batch).not.toHaveBeenCalled(); expect(await getBalance(f.userId)).toBe(1000);
  });

  it("rejects the formerly free wired OpenRouter request before creating a run or reservation", async () => {
    const f = await fixture();
    const graph = [
      { id: "prompt", type: "text", position: { x: 0, y: 0 }, data: { text: "Write a long story" } },
      { id: "model", type: "openrouter-llm", position: { x: 100, y: 0 }, data: { user_message: "", model: "anthropic/claude-sonnet-4-5", max_tokens: 8192 } },
    ];
    await expect(executeWorkflow(f.userId, f.workflow.id, {
      nodesOverride: graph,
      edgesOverride: [{ id: "prompt-model", source: "prompt", target: "model", sourceHandle: "text_output", targetHandle: "user_message" }],
    })).rejects.toThrow("Insufficient credits");
    expect(await prisma.run.count({ where: { userId: f.userId } })).toBe(0);
    expect(await prisma.creditLedger.count({ where: { userId: f.userId, reason: "reserve:run" } })).toBe(0);
    expect(await getBalance(f.userId)).toBe(1000);
    expect(dispatch.trigger).not.toHaveBeenCalled();
    expect(dispatch.batch).not.toHaveBeenCalled();
  });

  it("rejects a wired billing limit violation while completing an independent node in the same layer", async () => {
    const f = await fixture(4_000_000);
    const result = await executeWorkflow(f.userId, f.workflow.id, {
      nodesOverride: [
        { id: "limit", type: "text", position: { x: 0, y: 0 }, data: { text: "1.5" } },
        ...nodes,
        { id: "model", type: "openrouter-llm", position: { x: 100, y: 0 }, data: { user_message: "Hello", max_tokens: 8192 } },
      ],
      edgesOverride: [
        { id: "limit-crop", source: "limit", target: "paid", sourceHandle: "text_output", targetHandle: "x_percent" },
        { id: "limit-model", source: "limit", target: "model", sourceHandle: "text_output", targetHandle: "max_tokens" },
      ],
    });
    await worker(f.userId, result.executionId);
    expect(dispatch.batch).toHaveBeenCalledTimes(1);
    expect(dispatch.batch.mock.calls[0][0]).toMatchObject([{ id: "crop-image", payload: { x: 1.5 } }]);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: result.executionId }, include: { nodeRuns: true } });
    expect(run).toMatchObject({ status: "PARTIAL", chargedCredits: 80 });
    expect(run.nodeRuns.find(node => node.nodeId === "paid")).toMatchObject({ status: "SUCCESS", creditsUsed: 80 });
    expect(run.nodeRuns.find(node => node.nodeId === "model")).toMatchObject({ status: "FAILED", creditsUsed: 0 });
    expect(run.nodeRuns.find(node => node.nodeId === "model")?.error).toContain("Output token limit");
    expect(await getBalance(f.userId)).toBe(3_999_920);
  });

  it("keeps an insufficient saved node budget fatal before any provider dispatch", async () => {
    const f = await fixture(4_000_000);
    const result = await executeWorkflow(f.userId, f.workflow.id, {
      nodesOverride: [...nodes, { id: "model", type: "openrouter-llm", position: { x: 100, y: 0 }, data: { user_message: "Hello" } }],
    });
    const run = await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } });
    const snapshot = run.graphSnapshot as { estimates: { perNode: Array<{ nodeId: string; estimate: number }> } };
    snapshot.estimates.perNode.find(node => node.nodeId === "model")!.estimate = 0;
    await prisma.run.update({ where: { id: result.executionId }, data: { graphSnapshot: snapshot } });
    await expect(worker(f.userId, result.executionId)).rejects.toThrow("prepared budget");
    expect(dispatch.batch).not.toHaveBeenCalled();
    expect(await getBalance(f.userId)).toBe(4_000_000);
    expect((await prisma.run.findUniqueOrThrow({ where: { id: result.executionId } })).status).toBe("FAILED");
  });

  it("keeps run history and reservations when workflow deletion is requested", async () => {
    const f = await fixture(); const run = await executeWorkflow(f.userId, f.workflow.id);
    const caller = workflowRouter.createCaller({ auth: { userId: f.userId }, prisma } as unknown as Parameters<typeof workflowRouter.createCaller>[0]);
    await expect(caller.delete({ id: f.workflow.id })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await prisma.run.findUnique({ where: { id: run.executionId } })).not.toBeNull();
    await requestRunCancellation(f.userId, run.executionId);
    expect(await getBalance(f.userId)).toBe(1000);
  });
  it("serializes deletion with new run creation without leaving an orphan hold", async () => {
    const f = await fixture();
    const caller = workflowRouter.createCaller({ auth: { userId: f.userId }, prisma } as unknown as Parameters<typeof workflowRouter.createCaller>[0]);
    const [execution, deletion] = await Promise.allSettled([executeWorkflow(f.userId, f.workflow.id), caller.delete({ id: f.workflow.id })]);
    if (execution.status === "fulfilled") {
      expect(deletion.status).toBe("rejected");
      await requestRunCancellation(f.userId, execution.value.executionId);
    } else expect(deletion.status).toBe("fulfilled");
    expect(await getBalance(f.userId)).toBe(1000);
  });

});
