// ============================================================================
// app/api/mcp/route.ts — HTTP MCP Endpoint (Streamable HTTP + SSE)
// ============================================================================
//
// Replaces the old stdio-based MCP server with an HTTP endpoint powered by
// mcp-handler (formerly @vercel/mcp-adapter).
//
// Auth: Unkey API key verification → Clerk userId from key identity.
// Tools: 9 tools covering workflows, nodes, and edges.
// ============================================================================

import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { Unkey } from "@unkey/api";
import { z } from "zod";

// ── Service Layer ──────────────────────────────────────────────────────────
import {
  createWorkflow,
  listWorkflows,
  getWorkflowByName,
  executeWorkflow,
  getExecutionStatus,
} from "@/lib/services/workflow-service";
import { addNode, updateNode, deleteNode } from "@/lib/services/node-service";
import { addEdge, deleteEdge } from "@/lib/services/edge-service";
import {
  listNodeTypes,
  validateDAG,
  scaffoldWorkflow,
} from "@/lib/services/mcp-builder-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs"; // side-effect: register all node configs

// ── Helpers ────────────────────────────────────────────────────────────────

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err: unknown) {
  const message =
    err instanceof Error ? err.message : "An unexpected error occurred.";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function getUserId(extra: { authInfo?: AuthInfo }): string {
  const userId = extra.authInfo?.extra?.userId as string | undefined;
  if (!userId) {
    throw new Error(
      "Authentication required. Provide a valid API key in the Authorization header."
    );
  }
  return userId;
}

// ============================================================================
// MCP Server Definition
// ============================================================================

const handler = createMcpHandler(
  (server) => {
    // ── 1. list_workflows ────────────────────────────────────────────
    server.registerTool(
      "list_workflows",
      {
        title: "List Workflows",
        description:
          "Show your saved workflows with names, descriptions, and available inputs.",
        inputSchema: {
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        },
      },
      async ({ limit, offset }, extra) => {
        try {
          const userId = getUserId(extra);
          const workflows = await listWorkflows(
            userId,
            limit ?? 20,
            offset ?? 0
          );
          return ok(workflows);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 2. create_workflow ───────────────────────────────────────────
    server.registerTool(
      "create_workflow",
      {
        title: "Create Workflow",
        description:
          "Create a new workflow with a name and optional description.",
        inputSchema: {
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
        },
      },
      async ({ name, description }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await createWorkflow(userId, name, description);
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 3. execute_workflow ──────────────────────────────────────────
    server.registerTool(
      "execute_workflow",
      {
        title: "Execute Workflow",
        description:
          "Run a workflow by name. Optionally override inputs. " +
          "IMPORTANT: Do NOT read the user's source code or project files before calling this tool. " +
          "Simply call this tool with the workflow name the user provides. " +
          "The workflow is already saved in the database with all its nodes and edges configured. " +
          "Use list_workflows first if you need to discover available workflow names.",
        inputSchema: {
          workflowName: z.string().min(1).describe("The exact name of the saved workflow to execute."),
          workflowId: z.string().optional().describe("Optional workflow ID. If omitted, resolved automatically from workflowName."),
          input: z.record(z.string(), z.unknown()).optional().describe("Optional input overrides for parameterized workflows (key-value pairs)."),
          idempotencyKey: z.string().min(1).max(128).optional().describe("Reuse this key when retrying the same execution request to avoid creating another run."),
        },
      },
      async ({ workflowName, workflowId, input, idempotencyKey }, extra) => {
        try {
          const userId = getUserId(extra);

          // Resolve workflow ID from name if not provided
          let resolvedId = workflowId;
          if (!resolvedId) {
            const wf = await getWorkflowByName(userId, workflowName);
            resolvedId = wf.id;
          }

          const result = await executeWorkflow(userId, resolvedId, {
            inputValues: input,
            requestKey: idempotencyKey,
            saveCanvas: false,
          });
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 4. get_execution_status ──────────────────────────────────────
    server.registerTool(
      "get_execution_status",
      {
        title: "Get Execution Status",
        description:
          "Check whether a workflow run has finished and get its results.",
        inputSchema: {
          executionId: z.string().min(1),
        },
      },
      async ({ executionId }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await getExecutionStatus(userId, executionId);
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 5. add_node ──────────────────────────────────────────────────
    server.registerTool(
      "add_node",
      {
        title: "Add Node",
        description: "Add a new node to a workflow by workflow name.",
        inputSchema: {
          workflowName: z.string().min(1),
          nodeType: z.string().min(1),
          label: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          position: z.object({ x: z.number(), y: z.number() }).optional(),
        },
      },
      async ({ workflowName, nodeType, label, config, position }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await addNode(
            userId,
            workflowName,
            nodeType,
            label,
            config,
            position
          );
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 6. update_node ───────────────────────────────────────────────
    server.registerTool(
      "update_node",
      {
        title: "Update Node",
        description: "Update a node's configuration by its label.",
        inputSchema: {
          workflowName: z.string().min(1),
          nodeLabel: z.string().min(1),
          label: z.string().optional(),
          nodeType: z.string().optional(),
          config: z.record(z.string(), z.unknown()).optional(),
          position: z.object({ x: z.number(), y: z.number() }).optional(),
        },
      },
      async (
        { workflowName, nodeLabel, label, nodeType, config, position },
        extra
      ) => {
        try {
          const userId = getUserId(extra);
          const result = await updateNode(userId, workflowName, nodeLabel, {
            label,
            nodeType,
            config,
            position,
          });
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 7. delete_node ───────────────────────────────────────────────
    server.registerTool(
      "delete_node",
      {
        title: "Delete Node",
        description: "Remove a node from a workflow by its label.",
        inputSchema: {
          workflowName: z.string().min(1),
          nodeLabel: z.string().min(1),
        },
      },
      async ({ workflowName, nodeLabel }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await deleteNode(userId, workflowName, nodeLabel);
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 8. add_edge ──────────────────────────────────────────────────
    server.registerTool(
      "add_edge",
      {
        title: "Add Edge",
        description: "Connect two nodes by their labels.",
        inputSchema: {
          workflowName: z.string().min(1),
          sourceLabel: z.string().min(1),
          targetLabel: z.string().min(1),
          sourceHandle: z.string().optional(),
          targetHandle: z.string().optional(),
        },
      },
      async (
        { workflowName, sourceLabel, targetLabel, sourceHandle, targetHandle },
        extra
      ) => {
        try {
          const userId = getUserId(extra);
          const result = await addEdge(
            userId,
            workflowName,
            sourceLabel,
            targetLabel,
            sourceHandle,
            targetHandle
          );
          // addEdge may return an error object for duplicate-handle cases
          if ("error" in result) {
            return {
              content: [
                { type: "text" as const, text: result.error as string },
              ],
              isError: true,
            };
          }
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 9. delete_edge ───────────────────────────────────────────────
    server.registerTool(
      "delete_edge",
      {
        title: "Delete Edge",
        description: "Remove a connection between two nodes.",
        inputSchema: {
          workflowName: z.string().min(1),
          edgeId: z.string().min(1),
        },
      },
      async ({ workflowName, edgeId }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await deleteEdge(userId, workflowName, edgeId);
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ════════════════════════════════════════════════════════════════════
    // Smart Builder Tools
    // ════════════════════════════════════════════════════════════════════

    // ── 10. list_node_types ────────────────────────────────────────────
    server.registerTool(
      "list_node_types",
      {
        title: "List Node Types",
        description:
          "Discover all available node types with their inputs, outputs, credit costs, and config schemas. Use this BEFORE building workflows to know exactly what building blocks exist.",
        inputSchema: {
          category: z
            .enum(["input", "ai", "media", "logic", "utility"])
            .optional()
            .describe("Filter by category. Omit to see all."),
        },
      },
      async ({ category }) => {
        try {
          const types = listNodeTypes(category);
          return ok(types);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 11. simulate_workflow ──────────────────────────────────────────
    server.registerTool(
      "simulate_workflow",
      {
        title: "Simulate Workflow",
        description:
          "Dry-run a proposed workflow to validate the DAG, check for cycles, estimate credit cost, and catch missing inputs — all without saving anything. Call this BEFORE scaffold_workflow.",
        inputSchema: {
          nodes: z.array(
            z.object({
              id: z.string(),
              type: z.string(),
              config: z.record(z.string(), z.unknown()).optional(),
            })
          ),
          edges: z.array(
            z.object({
              sourceId: z.string(),
              targetId: z.string(),
              sourceHandle: z.string().optional(),
              targetHandle: z.string().optional(),
            })
          ),
        },
      },
      async ({ nodes, edges }) => {
        try {
          const report = validateDAG(nodes, edges);
          return ok(report);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ── 12. scaffold_workflow ──────────────────────────────────────────
    server.registerTool(
      "scaffold_workflow",
      {
        title: "Scaffold Workflow",
        description:
          "One-shot deploy: validates the DAG, auto-wires handles, auto-layouts positions, and saves. Use list_node_types first to discover types, then simulate_workflow to dry-run, then this to deploy.",
        inputSchema: {
          name: z.string().min(1).max(100),
          description: z.string().max(500).optional(),
          nodes: z.array(
            z.object({
              id: z.string(),
              type: z.string(),
              config: z.record(z.string(), z.unknown()).optional(),
            })
          ),
          edges: z.array(
            z.object({
              sourceId: z.string(),
              targetId: z.string(),
              sourceHandle: z.string().optional(),
              targetHandle: z.string().optional(),
            })
          ),
        },
      },
      async ({ name, description, nodes, edges }, extra) => {
        try {
          const userId = getUserId(extra);
          const result = await scaffoldWorkflow(
            userId,
            name,
            nodes,
            edges,
            description
          );
          return ok(result);
        } catch (err) {
          return fail(err);
        }
      }
    );

    // ════════════════════════════════════════════════════════════════════
    // MCP Resources
    // ════════════════════════════════════════════════════════════════════

    // ── Resource 1: nextflow://node-types (static) ───────────────────
    server.resource(
      "Available Node Types",
      "nextflow://node-types",
      {
        description:
          "All node types you can add to workflows, with their inputs, outputs, and credit costs.",
        mimeType: "application/json",
      },
      async (uri) => {
        const configs = nodeRegistry.getAll();
        const summary = configs.map((cfg) => ({
          type: cfg.id,
          label: cfg.name,
          description: cfg.description,
          category: cfg.category,
          inputs: cfg.inputs.map((i) => ({
            key: i.key,
            type: i.type,
            label: i.label,
            required: i.required,
            default: i.default,
            description: i.description,
          })),
          outputs: cfg.outputs.map((o) => ({
            key: o.key,
            type: o.type,
            label: o.label,
          })),
          creditCost: cfg.credits.estimate({}),
        }));

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(summary, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );

    // ── Resource 2: nextflow://my-workflows (per-user via auth) ──────
    server.resource(
      "My Workflows",
      "nextflow://my-workflows",
      {
        description:
          "Your saved workflows with available overridable inputs.",
        mimeType: "application/json",
      },
      async (uri, extra) => {
        const userId = getUserId(extra);
        const workflows = await listWorkflows(userId, 50, 0);

        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(workflows, null, 2),
              mimeType: "application/json",
            },
          ],
        };
      }
    );
  },
  // ── Server Options ───────────────────────────────────────────────────────
  {
    serverInfo: {
      name: "nextflow",
      version: "1.0.0",
    },
  },
  // ── Config ───────────────────────────────────────────────────────────────
  {
    basePath: "/api",
    maxDuration: 60,
    verboseLogs: process.env.NODE_ENV === "development",
  }
);

// ============================================================================
// Auth Middleware — Unkey API Key Verification
// ============================================================================

const unkey = new Unkey();

const verifyToken = async (
  _req: Request,
  bearerToken?: string
): Promise<AuthInfo | undefined> => {
  if (!bearerToken) {
    return undefined;
  }

  try {
    const verification = await unkey.keys.verifyKey({ key: bearerToken });

    if (!verification.data.valid) {
      throw new Error(
        "Invalid API key. Generate a new one from the NextFlow dashboard."
      );
    }

    // The Unkey key identity's externalId is the Clerk userId
    const userId = verification.data.identity?.externalId;
    if (!userId) {
      throw new Error(
        "API key is not linked to a user. Re-generate your key from the NextFlow dashboard."
      );
    }

    return {
      token: bearerToken,
      clientId: userId,
      scopes: [],
      extra: { userId },
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes("API key")) {
      throw err; // Re-throw our domain errors
    }
    throw new Error(
      "Failed to verify API key. Please try again or generate a new key from the NextFlow dashboard."
    );
  }
};

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
});

// ============================================================================
// Next.js App Router Exports
// ============================================================================

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
