import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma }));

import { addNode, deleteNode, updateNode } from "@/lib/services/node-service";
import { addEdge, deleteEdge } from "@/lib/services/edge-service";

function fixture() {
  const stored = {
    id: "wf1", name: "Demo",
    nodes: [
      { id: "n1", type: "text", position: { x: 0, y: 0 }, data: { label: "Brief", text: "hello" } },
      { id: "n2", type: "llm", position: { x: 1, y: 0 }, data: { label: "Model" } },
    ],
    edges: [{ id: "e1", source: "n1", target: "n2", sourceHandle: "text", targetHandle: "prompt" }],
  };
  const tx = {
    workflow: {
      findFirst: vi.fn(async () => structuredClone(stored)),
      findUnique: vi.fn(async () => structuredClone(stored)),
      update: vi.fn(async () => ({ id: "wf1" })),
    },
    $queryRawUnsafe: vi.fn(async () => [{ id: "wf1" }]),
  };
  prisma.$transaction.mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx));
  return tx;
}

beforeEach(() => vi.clearAllMocks());

describe("workflow revision updates for graph mutations", () => {
  it.each([
    ["add node", () => addNode("owner", "Demo", "text", "Extra")],
    ["update node", () => updateNode("owner", "Demo", "Brief", { config: { text: "changed" } })],
    ["delete node", () => deleteNode("owner", "Demo", "Brief")],
    ["add edge", () => addEdge("owner", "Demo", "Brief", "Model", "text", "system_prompt")],
    ["delete edge", () => deleteEdge("owner", "Demo", "e1")],
  ] as const)("increments the revision within the locked %s transaction", async (_name, mutate) => {
    const tx = fixture();
    await mutate();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workflow.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "owner" }) }));
    expect(tx.workflow.update).toHaveBeenCalledTimes(1);
    expect(tx.workflow.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "wf1" }, data: expect.objectContaining({ revision: { increment: 1 } }) }));
    expect(tx.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(tx.workflow.update.mock.invocationCallOrder[0]);
  });

  it("does not increment a revision when a duplicate edge is rejected", async () => {
    const tx = fixture();
    await expect(addEdge("owner", "Demo", "Brief", "Model", "text", "prompt")).resolves.toHaveProperty("error");
    expect(tx.workflow.update).not.toHaveBeenCalled();
  });

  it("does not increment a revision when a requested node is missing", async () => {
    const tx = fixture();
    await expect(updateNode("owner", "Demo", "Missing", { label: "New" })).rejects.toMatchObject({ name: "NodeNotFoundError" });
    expect(tx.workflow.update).not.toHaveBeenCalled();
  });
});
