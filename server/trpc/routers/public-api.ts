import { z } from "zod";
import { createPublicApiRouter, publicApiProcedure } from "../trpc";
import { appRouter } from "../root";
import { TRPCError } from "@trpc/server";
import { getExposedInputs } from "../../../lib/nodes/exposed-inputs";
import { nodeRegistry } from "../../../lib/nodes/registry";
import { executeWorkflow } from "../../../lib/services/workflow-service";
import { translateServiceError } from "./workflow";
export const publicApiRouter = createPublicApiRouter({
  listWorkflows: publicApiProcedure
    .meta({
      openapi: { method: "GET", path: "/v1/workflows", protect: true, tags: ["Workflows"], summary: "List workflows" }
    })
    .input(z.void())
    .output(z.object({ workflows: z.array(z.object({ id: z.string(), name: z.string(), updatedAt: z.date() })) }))
    .query(async ({ ctx }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      const workflows = await caller.workflow.list();
      return { workflows };
    }),

  getWorkflow: publicApiProcedure
    .meta({
      openapi: { method: "GET", path: "/v1/workflows/{id}", protect: true, tags: ["Workflows"], summary: "Get workflow" }
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ 
      id: z.string(), 
      userId: z.string(),
      name: z.string(), 
      nodes: z.unknown(), 
      edges: z.unknown(), 
      createdAt: z.date(), 
      updatedAt: z.date() 
    }))
    .query(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      const workflow = await caller.workflow.load({ id: input.id });
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
      return workflow;
    }),

  executeWorkflow: publicApiProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/v1/workflows/{id}/execute",
        protect: true,
        tags: ["Executions"],
        summary: "Execute full workflow",
        description:
          "Trigger a full execution of a workflow. Optionally override node inputs by providing a mapping of node IDs to their input values.",
      },
    })
    .input(
      z.object({
        id: z.string(),
        idempotencyKey: z.string().min(1).max(128).optional().describe(
          "Reuse this key when retrying the same execution request to avoid creating another run."
        ),
        inputs: z
          .record(z.string(), z.record(z.string(), z.any()))
          .optional()
          .describe(
            "Low-level overrides by node ID. Keys are internal node IDs, values are objects of field overrides. Works for ANY field on ANY node regardless of exposure. Use GET /v1/workflows/{id} to inspect node IDs."
          ),
        variables: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "Override exposed inputs by node label. Keys MUST match the exact node label from the canvas editor (node.data.label). Only works for passthrough nodes (auto-exposed) and fields marked as exposed via exposedInputKeys. Non-matching keys are silently ignored."
          ),
        webhook: z.object({
          url: z.string().url().describe("The URL to receive POST notifications."),
          events: z.array(
            z.enum(["run.completed", "run.failed"])
          ).optional().describe("Which events to subscribe to. Defaults to all."),
        }).optional().describe(
          "Webhook configuration for async completion notifications."
        ),
      })
    )
    .output(z.object({ runId: z.string(), workflowId: z.string(), scope: z.string(), nodeCount: z.number(), estimatedCredits: z.number(), status: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      
      const workflow = await caller.workflow.load({ id: input.id });
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
      
      const nodes = workflow.nodes as any[];

      // ── 1. Map `inputs` (by node ID) to flattened overrides ────────
      const flattenedOverrides: Record<string, any> = {};
      const flattenedVariables: Record<string, any> = {};
      
      if (input.inputs) {
        for (const [nodeId, nodeData] of Object.entries(input.inputs)) {
          if (typeof nodeData === "object" && nodeData !== null) {
            for (const [field, value] of Object.entries(nodeData as Record<string, any>)) {
              flattenedOverrides[`${nodeId}.${field}`] = value;
            }
          }
        }
      }

      // ── 2. Map `variables` (by node label) to flattened overrides ──
      if (input.variables) {
        const { inputs: exposedInputs } = getExposedInputs(nodes, nodeRegistry);

        for (const [label, fields] of Object.entries(input.variables)) {
          if (typeof fields === "object" && fields !== null) {
            for (const [field, value] of Object.entries(fields as Record<string, any>)) {
              flattenedVariables[`${label}.${field}`] = value;
            }
          } else {
            // First check if 'label' perfectly matches an exposed input (e.g., passthrough or exact label.key)
            if (exposedInputs.some((ei) => ei.label === label)) {
              flattenedVariables[label] = fields;
            } else {
              // Fuzzy match: if user provided just the node label (e.g., "OpenRouter LLM"), 
              // and that node only exposes exactly ONE input, map it automatically.
              const matchingExposed = exposedInputs.filter((ei) => {
                const nodeLabel = nodes.find((n) => n.id === ei.nodeId)?.data?.label || ei.nodeType;
                return nodeLabel === label;
              });

              if (matchingExposed.length === 1) {
                flattenedVariables[matchingExposed[0].label] = fields;
              } else {
                // Fallback (will likely be ignored by the orchestrator)
                flattenedVariables[label] = fields;
              }
            }
          }
        }
      }

      // Merge both types of overrides into a single record for the orchestrator
      const inputValues = { ...flattenedOverrides, ...flattenedVariables };

      console.log("[API] Runtime overrides prepared:", Object.keys(inputValues));

      try {
        const res = await executeWorkflow(ctx.apiUserId, workflow.id, {
          inputValues: Object.keys(inputValues).length > 0 ? inputValues : undefined,
          webhookUrl: input.webhook?.url,
          requestKey: input.idempotencyKey,
          saveCanvas: false,
        });
        return {
          runId: res.executionId,
          workflowId: workflow.id,
          scope: res.scope,
          nodeCount: res.nodeCount,
          estimatedCredits: res.estimatedCredits,
          status: res.status,
        };
      } catch (error) {
        translateServiceError(error);
      }
    }),

  executeSelected: publicApiProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/v1/workflows/{id}/execute-selected",
        protect: true,
        tags: ["Executions"],
        summary: "Execute selected nodes",
        description:
          "Trigger a partial execution of a workflow by specifying which node IDs to run. Optionally override node inputs.",
      },
    })
    .input(
      z.object({
        id: z.string(),
        idempotencyKey: z.string().min(1).max(128).optional().describe(
          "Reuse this key when retrying the same execution request to avoid creating another run."
        ),
        selectedNodeIds: z.array(z.string()).meta({
          description: "Array of Node IDs to execute.",
          examples: [["node_4", "node_5"]],
        }),
        inputs: z
          .record(z.string(), z.record(z.string(), z.any()))
          .optional()
          .describe(
            "Low-level overrides by node ID. Keys are internal node IDs, values are objects of field overrides. Works for ANY field on ANY node regardless of exposure."
          ),
        variables: z
          .record(z.string(), z.any())
          .optional()
          .describe(
            "Override exposed inputs by node label. Keys MUST match the exact node label from the canvas editor. Only works for exposed inputs — non-matching keys are silently ignored."
          ),
        webhook: z.object({
          url: z.string().url().describe("The URL to receive POST notifications."),
          events: z.array(
            z.enum(["run.completed", "run.failed"])
          ).optional().describe("Which events to subscribe to. Defaults to all."),
        }).optional().describe(
          "Webhook configuration for async completion notifications."
        ),
      })
    )
    .output(z.object({ runId: z.string(), workflowId: z.string(), scope: z.string(), nodeCount: z.number(), estimatedCredits: z.number(), status: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      
      const workflow = await caller.workflow.load({ id: input.id });
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
      
      const nodes = workflow.nodes as any[];

      // ── 1. Map `inputs` (by node ID) to flattened overrides ────────
      const flattenedOverrides: Record<string, any> = {};
      const flattenedVariables: Record<string, any> = {};
      
      if (input.inputs) {
        for (const [nodeId, nodeData] of Object.entries(input.inputs)) {
          if (typeof nodeData === "object" && nodeData !== null) {
            for (const [field, value] of Object.entries(nodeData as Record<string, any>)) {
              flattenedOverrides[`${nodeId}.${field}`] = value;
            }
          }
        }
      }

      // ── 2. Map `variables` (by node label) to flattened overrides ──
      if (input.variables) {
        const { inputs: exposedInputs } = getExposedInputs(nodes, nodeRegistry);

        for (const [label, fields] of Object.entries(input.variables)) {
          if (typeof fields === "object" && fields !== null) {
            for (const [field, value] of Object.entries(fields as Record<string, any>)) {
              flattenedVariables[`${label}.${field}`] = value;
            }
          } else {
            // First check if 'label' perfectly matches an exposed input
            if (exposedInputs.some((ei) => ei.label === label)) {
              flattenedVariables[label] = fields;
            } else {
              // Fuzzy match: if user provided just the node label and it has exactly ONE exposed input
              const matchingExposed = exposedInputs.filter((ei) => {
                const nodeLabel = nodes.find((n) => n.id === ei.nodeId)?.data?.label || ei.nodeType;
                return nodeLabel === label;
              });

              if (matchingExposed.length === 1) {
                flattenedVariables[matchingExposed[0].label] = fields;
              } else {
                flattenedVariables[label] = fields;
              }
            }
          }
        }
      }

      const inputValues = { ...flattenedOverrides, ...flattenedVariables };

      try {
        const res = await executeWorkflow(ctx.apiUserId, workflow.id, {
          selectedNodeIds: input.selectedNodeIds,
          inputValues: Object.keys(inputValues).length > 0 ? inputValues : undefined,
          webhookUrl: input.webhook?.url,
          requestKey: input.idempotencyKey,
          saveCanvas: false,
        });
        return {
          runId: res.executionId,
          workflowId: workflow.id,
          scope: res.scope,
          nodeCount: res.nodeCount,
          estimatedCredits: res.estimatedCredits,
          status: res.status,
        };
      } catch (error) {
        translateServiceError(error);
      }
    }),

  getExecution: publicApiProcedure
    .meta({
      openapi: { method: "GET", path: "/v1/executions/{id}", protect: true, tags: ["Executions"], summary: "Get execution status" }
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({
      id: z.string(),
      status: z.string(),
      scope: z.string(),
      nodeRuns: z.array(z.unknown()),
      durationMs: z.number().optional()
    }))
    .query(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      const status = await caller.workflow.status({ runId: input.id });
      
      return {
        id: status.id,
        status: status.status,
        scope: status.scope,
        nodeRuns: status.nodeRuns,
        durationMs: status.durationMs ?? undefined,
      };
    }),

  getCredits: publicApiProcedure
    .meta({
      openapi: { method: "GET", path: "/v1/credits", protect: true, tags: ["Credits"], summary: "Get account credits" }
    })
    .input(z.void())
    .output(z.object({ balance: z.number(), formatted: z.string() }))
    .query(async ({ ctx }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      return caller.credits.getBalance();
    }),
});
