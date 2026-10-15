import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnershipError, WorkflowNotFoundError, WorkflowConflictError } from "@/lib/services/errors";
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/nodes/configs", () => ({}));
vi.mock("@/lib/services/workflow-service", () => ({ executeWorkflow: vi.fn(), cloneWorkflow: vi.fn(), requestRunCancellation: vi.fn(), retryRunDispatch: vi.fn() }));
vi.mock("@/lib/credits/credit-service", () => ({ estimateWorkflowCost: vi.fn() }));
import { executeWorkflow } from "@/lib/services/workflow-service";
import { workflowRouter } from "@/server/trpc/routers/workflow";
const graph = [{ id: "n1", type: "text", position: { x: 0, y: 0 }, data: { text: "updated" } }];
const result = { executionId: "run1", workflowId: "wf1", triggerId: "trigger1", publicAccessToken: "public1", status: "triggered", scope: "FULL", nodeCount: 1, estimatedCredits: 0, executedNodes: [] };
const prisma = { workflow: { update: vi.fn(), create: vi.fn() } };
const caller = workflowRouter.createCaller({ auth: { userId: "user1" }, prisma } as unknown as Parameters<typeof workflowRouter.createCaller>[0]);
beforeEach(() => vi.resetAllMocks());
describe("canvas execution adapter", () => {
  it.each([[new OwnershipError(), "FORBIDDEN"], [new WorkflowNotFoundError("missing"), "NOT_FOUND"], [new WorkflowConflictError(), "CONFLICT"]])("translates shared ownership, missing and revision errors without a separate graph write", async (error, code) => {
    vi.mocked(executeWorkflow).mockRejectedValue(error);
    await expect(caller.execute({ workflowId: "wf1", expectedRevision: 3, nodes: graph, edges: [] })).rejects.toMatchObject({ code });
    expect(prisma.workflow.update).not.toHaveBeenCalled();
    expect(prisma.workflow.create).not.toHaveBeenCalled();
  });
  it("executes the confirmed saved revision without overwriting it with canvas state", async () => {
    vi.mocked(executeWorkflow).mockResolvedValue(result);
    await expect(caller.execute({ workflowId: "wf1", expectedRevision: 3, nodes: graph, edges: [], idempotencyKey: "request1" })).resolves.toMatchObject({ runId: "run1" });
    expect(executeWorkflow).toHaveBeenCalledWith("user1", "wf1", expect.objectContaining({ nodesOverride: undefined, edgesOverride: undefined, saveCanvas: false, expectedRevision: 3, requestKey: "request1" }));
    expect(prisma.workflow.update).not.toHaveBeenCalled();
  });
  it("rejects a saved workflow without a confirmed revision before dispatch", async () => {
    await expect(caller.execute({ workflowId: "wf1", nodes: graph, edges: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(executeWorkflow).not.toHaveBeenCalled();
    expect(prisma.workflow.update).not.toHaveBeenCalled();
  });
  it.each([undefined, "temp-visual-id"])("lets shared preparation create new workflow atomically for %s", async workflowId => {
    vi.mocked(executeWorkflow).mockResolvedValue(result);
    await caller.execute({ workflowId, nodes: graph, edges: [] });
    expect(executeWorkflow).toHaveBeenCalledWith("user1", "", expect.objectContaining({ nodesOverride: graph, edgesOverride: [], saveCanvas: true }));
    expect(prisma.workflow.create).not.toHaveBeenCalled();
  });
});
