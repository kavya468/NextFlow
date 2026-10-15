import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OwnershipError } from "@/lib/services/errors";

type Tool = {
  config: { inputSchema: z.ZodRawShape };
  run: (input: Record<string, unknown>, extra: { authInfo?: { extra: { userId: string } } }) => Promise<unknown>;
};
const mocks = vi.hoisted(() => ({ tools: new Map<string, Tool>() }));

vi.mock("@/lib/services/workflow-service", () => ({
  executeWorkflow: vi.fn(), getWorkflowByName: vi.fn(), createWorkflow: vi.fn(), listWorkflows: vi.fn(), getExecutionStatus: vi.fn(),
}));
vi.mock("@/lib/services/node-service", () => ({ addNode: vi.fn(), updateNode: vi.fn(), deleteNode: vi.fn() }));
vi.mock("@/lib/services/edge-service", () => ({ addEdge: vi.fn(), deleteEdge: vi.fn() }));
vi.mock("@/lib/services/mcp-builder-service", () => ({ listNodeTypes: vi.fn(), validateDAG: vi.fn(), scaffoldWorkflow: vi.fn() }));
vi.mock("@/lib/nodes/configs", () => ({}));
vi.mock("@unkey/api", () => ({ Unkey: class { keys = { verifyKey: vi.fn() }; } }));
vi.mock("mcp-handler", () => ({
  createMcpHandler: (initialize: (server: { registerTool: (name: string, config: Tool["config"], run: Tool["run"]) => void; resource: () => void }) => void) => {
    initialize({ registerTool: (name, config, run) => { mocks.tools.set(name, { config, run }); }, resource: vi.fn() });
    return vi.fn();
  },
  withMcpAuth: (handler: unknown) => handler,
}));

import { executeWorkflow, getWorkflowByName } from "@/lib/services/workflow-service";
import "@/app/api/mcp/route";

const auth = { authInfo: { extra: { userId: "owner" } } };
const execution: Awaited<ReturnType<typeof executeWorkflow>> = {
  executionId: "run1", workflowId: "wf1", status: "dispatch_unknown", scope: "FULL",
  triggerId: undefined, publicAccessToken: undefined,
  nodeCount: 1, estimatedCredits: 10, executedNodes: [],
};

function tool() {
  const registration = mocks.tools.get("execute_workflow");
  if (!registration) throw new Error("execute_workflow was not registered");
  return registration;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executeWorkflow).mockResolvedValue(execution);
  vi.mocked(getWorkflowByName).mockResolvedValue({ id: "wf1" } as Awaited<ReturnType<typeof getWorkflowByName>>);
});

describe("MCP execution adapter", () => {
  it("forwards an idempotency key and actor to the shared service without saving a canvas", async () => {
    const registered = tool();
    const input = z.object(registered.config.inputSchema).parse({ workflowName: "Demo", workflowId: "wf1", input: { Brief: "hello" }, idempotencyKey: "mcp-request-1" });
    const result = await registered.run(input, auth) as { content: Array<{ text: string }> };
    expect(executeWorkflow).toHaveBeenCalledWith("owner", "wf1", { inputValues: { Brief: "hello" }, requestKey: "mcp-request-1", saveCanvas: false });
    expect(getWorkflowByName).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toEqual(JSON.parse(JSON.stringify(execution)));
  });

  it("resolves a workflow name using the authenticated actor when no ID is supplied", async () => {
    await tool().run({ workflowName: "Demo" }, auth);
    expect(getWorkflowByName).toHaveBeenCalledWith("owner", "Demo");
    expect(executeWorkflow).toHaveBeenCalledWith("owner", "wf1", { inputValues: undefined, requestKey: undefined, saveCanvas: false });
  });

  it.each(["", "x".repeat(129)])("rejects invalid idempotency keys in the advertised MCP schema", (idempotencyKey) => {
    expect(() => z.object(tool().config.inputSchema).parse({ workflowName: "Demo", idempotencyKey })).toThrow();
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("does not dispatch without an authenticated actor", async () => {
    await expect(tool().run({ workflowName: "Demo", workflowId: "wf1" }, {})).resolves.toMatchObject({ isError: true });
    expect(executeWorkflow).not.toHaveBeenCalled();
  });

  it("reports a service ownership rejection as a tool error", async () => {
    vi.mocked(executeWorkflow).mockRejectedValue(new OwnershipError());
    await expect(tool().run({ workflowName: "Demo", workflowId: "another-user-workflow" }, auth)).resolves.toMatchObject({ isError: true });
    expect(executeWorkflow).toHaveBeenCalledWith("owner", "another-user-workflow", expect.anything());
  });
});
