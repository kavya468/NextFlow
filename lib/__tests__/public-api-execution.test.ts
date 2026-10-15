import { beforeEach, describe, expect, it, vi } from "vitest";
import { OwnershipError, ValidationError } from "@/lib/services/errors";

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  canvasExecute: vi.fn(),
  status: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/nodes/configs", () => ({}));
vi.mock("@/lib/credits/credit-service", () => ({ estimateWorkflowCost: vi.fn() }));
vi.mock("@/lib/services/workflow-service", () => ({ executeWorkflow: vi.fn(), cloneWorkflow: vi.fn() }));
vi.mock("@/server/trpc/root", () => ({
  appRouter: {
    createCaller: vi.fn(() => ({ workflow: { load: mocks.load, execute: mocks.canvasExecute, status: mocks.status } })),
  },
}));

import { executeWorkflow } from "@/lib/services/workflow-service";
import { publicApiRouter } from "@/server/trpc/routers/public-api";

const storedNodes = [{ id: "n1", type: "text", data: { label: "Brief", text: "stored" } }];
const result: Awaited<ReturnType<typeof executeWorkflow>> = {
  executionId: "run1", workflowId: "wf1", triggerId: "trigger1", status: "triggered",
  publicAccessToken: undefined,
  scope: "FULL", nodeCount: 1, estimatedCredits: 10, executedNodes: [],
};

function caller(apiUserId = "owner") {
  return publicApiRouter.createCaller({ apiUserId, prisma: {}, req: {} } as unknown as Parameters<typeof publicApiRouter.createCaller>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue({ id: "wf1", userId: "owner", nodes: structuredClone(storedNodes), edges: [] });
  vi.mocked(executeWorkflow).mockResolvedValue(result);
});

describe("REST execution adapter", () => {
  it("dispatches an owned stored graph without passing canvas state or saving it", async () => {
    const response = await caller().executeWorkflow({
      id: "wf1", idempotencyKey: "client-request-1",
      inputs: { n1: { text: "runtime override", seed: 0 } },
      variables: { Brief: "variable override", Model: { temperature: 0.4 } },
      webhook: { url: "https://callbacks.example/run" },
    });
    expect(executeWorkflow).toHaveBeenCalledWith("owner", "wf1", {
      inputValues: { "n1.text": "runtime override", "n1.seed": 0, Brief: "variable override", "Model.temperature": 0.4 },
      webhookUrl: "https://callbacks.example/run", requestKey: "client-request-1", saveCanvas: false,
    });
    expect(mocks.canvasExecute).not.toHaveBeenCalled();
    expect(response).toEqual({ runId: "run1", workflowId: "wf1", status: "triggered", scope: "FULL", nodeCount: 1, estimatedCredits: 10 });
    expect((await mocks.load.mock.results[0].value).nodes).toEqual(storedNodes);
  });

  it("forwards selected nodes and preserves a dispatch-unknown result for safe retries", async () => {
    vi.mocked(executeWorkflow).mockResolvedValue({ ...result, triggerId: undefined, status: "dispatch_unknown", scope: "SINGLE" });
    const response = await caller().executeSelected({ id: "wf1", selectedNodeIds: ["n1"], idempotencyKey: "selection-1" });
    expect(executeWorkflow).toHaveBeenCalledWith("owner", "wf1", {
      selectedNodeIds: ["n1"], inputValues: undefined, webhookUrl: undefined, requestKey: "selection-1", saveCanvas: false,
    });
    expect(response).toMatchObject({ runId: "run1", status: "dispatch_unknown", scope: "SINGLE" });
    expect(mocks.canvasExecute).not.toHaveBeenCalled();
  });

  it.each(["", "x".repeat(129)])("rejects an invalid idempotency key before loading or dispatching", async (idempotencyKey) => {
    await expect(caller().executeWorkflow({ id: "wf1", idempotencyKey })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().executeSelected({ id: "wf1", selectedNodeIds: ["n1"], idempotencyKey })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it.each([
    [new OwnershipError(), "FORBIDDEN"],
    [new ValidationError("request key was reused for a different payload"), "BAD_REQUEST"],
  ])("translates shared service errors for API clients", async (error, code) => {
    vi.mocked(executeWorkflow).mockRejectedValue(error);
    await expect(caller().executeWorkflow({ id: "wf1" })).rejects.toMatchObject({ code });
    await expect(caller().executeSelected({ id: "wf1", selectedNodeIds: ["n1"] })).rejects.toMatchObject({ code });
  });

  it("rejects unauthenticated callers before dispatch", async () => {
    await expect(caller("").executeWorkflow({ id: "wf1" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it.each([1234, 0, null])("returns the stored execution duration (%s) without inventing timestamps", async (durationMs) => {
    mocks.status.mockResolvedValue({ id: "run1", status: "SUCCESS", scope: "FULL", nodeRuns: [], durationMs });
    const response = await caller().getExecution({ id: "run1" });
    expect(response.durationMs).toBe(durationMs ?? undefined);
  });
});
