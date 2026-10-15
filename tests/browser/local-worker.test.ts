import { expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ task: vi.fn(definition => definition), batch: vi.fn(() => { throw new Error("Provider work is forbidden in the browser harness"); }) }));
vi.mock("@trigger.dev/sdk", () => ({ task: transport.task, batch: { triggerAndWait: transport.batch }, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, metadata: { set: vi.fn() } }));

// Opt-in bridge: real local worker/database, no Trigger transport or paid provider requests.
it.skipIf(!process.env.NEXTFLOW_BROWSER_RUN_ID)("executes the explicitly selected local Text → Text browser fixture", async () => {
  const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
  if (database.hostname !== "127.0.0.1" || database.port !== "55432" || database.pathname !== "/nextflow_browser") throw new Error("Browser fixture database required");
  const { prisma } = await import("@/lib/db");
  try {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: process.env.NEXTFLOW_BROWSER_RUN_ID } });
    const snapshot = run.graphSnapshot as { nodes: Array<{ id: string; type: string; data: { text?: string } }>; edges: Array<{ source: string; target: string }> };
    expect(run.accountingVersion).toBe(1);
    expect(run.reservedCredits).toBe(0);
    expect(run.settledAt).toBeNull();
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.nodes.every(node => node.type === "text")).toBe(true);
    expect(snapshot.edges).toHaveLength(1);
    await import("@/src/trigger/orchestrator");
    const definition = transport.task.mock.calls.find(([definition]) => definition.id === "orchestrate-workflow")![0];
    await definition.run({ runId: run.id, userId: run.userId, recoveryAttempt: run.recoveryAttempt }, { ctx: { run: { id: `local-verification-${run.id}` } } });
    const result = await prisma.run.findUniqueOrThrow({ where: { id: run.id }, include: { nodeRuns: true } });
    const source = snapshot.nodes.find(node => node.id === snapshot.edges[0].source)!;
    const downstream = result.nodeRuns.find(node => node.nodeId === snapshot.edges[0].target)!;
    expect(result.status).toBe("SUCCESS");
    expect(result.chargedCredits).toBe(0);
    expect(downstream.inputs).toMatchObject({ text: source.data.text });
    expect(downstream.outputs).toEqual({ text_output: source.data.text });
    expect(transport.batch).not.toHaveBeenCalled();
    expect(await prisma.creditLedger.count({ where: { operationKey: `run:${run.id}:settle` } })).toBe(1);
  } finally { await prisma.$disconnect(); }
});
