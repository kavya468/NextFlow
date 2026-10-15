import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@trigger.dev/sdk", () => ({
  auth: { createPublicToken: vi.fn() }, tasks: { trigger: vi.fn() }, task: (definition: unknown) => definition,
}));
import { prisma } from "@/lib/db";
import { workflowRouter } from "@/server/trpc/routers/workflow";

const users: string[] = [];
const graph = (text: string) => ({ nodes: [{ id: "text", type: "text", position: { x: 0, y: 0 }, data: { text } }], edges: [] });
function caller(userId: string) {
  return workflowRouter.createCaller({ auth: { userId }, prisma } as unknown as Parameters<typeof workflowRouter.createCaller>[0]);
}
async function fixture() {
  const userId = `save-conflict-${randomUUID()}`;
  users.push(userId);
  await prisma.user.create({ data: { id: userId } });
  const workflow = await prisma.workflow.create({ data: { userId, name: "Original", ...graph("original") } });
  return { userId, workflow, api: caller(userId) };
}

beforeAll(() => {
  const database = new URL(process.env.DATABASE_URL || "http://missing");
  if (!["127.0.0.1", "localhost"].includes(database.hostname) || !["5432", "55432"].includes(database.port) || database.pathname !== "/nextflow_test") throw new Error("Save tests require isolated nextflow_test on localhost:5432 or localhost:55432.");
});
afterAll(async () => {
  await prisma.run.deleteMany({ where: { userId: { in: users } } });
  await prisma.workflow.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("workflow save revision boundary", () => {
  it("allows exactly one concurrent writer on the same revision", async () => {
    const { api, workflow } = await fixture();
    const attempts = await Promise.allSettled([
      api.update({ id: workflow.id, expectedRevision: 0, name: "First", ...graph("first") }),
      api.update({ id: workflow.id, expectedRevision: 0, name: "Second", ...graph("second") }),
    ]);
    expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("CONFLICT");
    const current = await api.load({ id: workflow.id });
    expect(current?.revision).toBe(1);
    const winner = attempts.find(result => result.status === "fulfilled") as PromiseFulfilledResult<NonNullable<typeof current>>;
    expect(current).toMatchObject({ name: winner.value.name, nodes: winner.value.nodes });
  });

  it("rejects stale full saves and stale renames without changing graph or title", async () => {
    const { api, workflow } = await fixture();
    const renamed = await api.update({ id: workflow.id, expectedRevision: 0, name: "New title" });
    expect(renamed.revision).toBe(1);
    await expect(api.save({ workflowId: workflow.id, expectedRevision: 0, name: "Old title", ...graph("stale") })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(api.update({ id: workflow.id, expectedRevision: 0, name: "Stale rename" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await api.load({ id: workflow.id })).toMatchObject({ name: "New title", revision: 1, nodes: graph("original").nodes });
  });

  it("rejects missing revisions and another owner's writes", async () => {
    const own = await fixture();
    const other = await fixture();
    await expect(own.api.save({ workflowId: own.workflow.id, ...graph("stale") })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(other.api.update({ id: own.workflow.id, expectedRevision: 0, ...graph("foreign") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(other.api.save({ creationId: own.workflow.id, ...graph("foreign") })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await own.api.load({ id: own.workflow.id })).toMatchObject({ revision: 0, nodes: graph("original").nodes });
  });

  it("replays an uncertain initial create without creating another workflow", async () => {
    const { api, userId } = await fixture();
    const creationId = randomUUID();
    const request = { creationId, name: "New project", ...graph("draft") };
    const [first, second] = await Promise.all([api.save(request), api.save(request)]);
    expect(first.workflowId).toBe(creationId);
    expect(second.workflowId).toBe(creationId);
    expect(await prisma.workflow.count({ where: { id: creationId, userId } })).toBe(1);
    expect(second.workflow.revision).toBe(0);
  });

  it("detects a lost acknowledgment on retry instead of silently replaying an existing update", async () => {
    const { api, workflow } = await fixture();
    const request = { id: workflow.id, expectedRevision: 0, ...graph("accepted") };
    await api.update(request);
    await expect(api.update(request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await api.load({ id: workflow.id })).toMatchObject({ revision: 1, nodes: graph("accepted").nodes });
  });


  it("makes dashboard renames conflict with stale editor saves", async () => {
    const { api, workflow } = await fixture();
    await api.rename({ id: workflow.id, name: "From dashboard", expectedRevision: 0 });
    await expect(api.update({ id: workflow.id, expectedRevision: 0, ...graph("stale canvas") })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(api.rename({ id: workflow.id, name: "Stale title", expectedRevision: 0 })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await api.load({ id: workflow.id })).toMatchObject({ name: "From dashboard", revision: 1 });
  });


  it("returns canonical deduplicated labels without mutating the submitted draft", async () => {
    const { api, workflow } = await fixture();
    const nodes = [
      { id: "a", type: "text", position: { x: 0, y: 0 }, data: { label: "Prompt", text: "first" } },
      { id: "b", type: "text", position: { x: 300, y: 0 }, data: { label: "Prompt", text: "second" } },
    ];
    const saved = await api.update({ id: workflow.id, expectedRevision: 0, nodes, edges: [] });
    const persisted = saved.nodes as typeof nodes;
    expect(new Set(persisted.map(node => node.data.label)).size).toBe(2);
    expect(nodes.map(node => node.data.label)).toEqual(["Prompt", "Prompt"]);
  });

  it("filters history by workflow and ownership while retaining the global query", async () => {
    const { api, userId, workflow } = await fixture();
    const second = await prisma.workflow.create({ data: { userId, name: "Second", ...graph("second") } });
    const foreign = await fixture();
    await prisma.run.createMany({ data: [
      { id: randomUUID(), workflowId: workflow.id, userId, status: "SUCCESS", scope: "FULL" },
      { id: randomUUID(), workflowId: second.id, userId, status: "SUCCESS", scope: "FULL" },
      { id: randomUUID(), workflowId: foreign.workflow.id, userId: foreign.userId, status: "SUCCESS", scope: "FULL" },
    ] });
    expect(await api.history({ workflowId: workflow.id })).toHaveLength(1);
    expect(await api.history({ workflowId: foreign.workflow.id })).toEqual([]);
    expect(await api.history()).toHaveLength(2);
  });
});
