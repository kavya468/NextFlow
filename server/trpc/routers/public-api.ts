import { z } from "zod";
import { createPublicApiRouter, publicApiProcedure } from "../trpc";
import { appRouter } from "../root";
import { TRPCError } from "@trpc/server";

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
        inputs: z
          .record(z.string(), z.record(z.string(), z.any()))
          .optional()
          .describe(
            "Low-level overrides by node ID. Keys are internal node IDs, values are objects of field overrides. Works for ANY field on ANY node regardless of exposure. Use GET /v1/workflows/{id} to inspect node IDs."
          ),
        variables: z
          .record(z.string(), z.record(z.string(), z.any()))
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
    .output(z.object({ runId: z.string(), workflowId: z.string(), scope: z.string(), nodeCount: z.number(), estimatedCredits: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      
      const workflow = await caller.workflow.load({ id: input.id });
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
      
      const nodes = workflow.nodes as any[];
      if (input.inputs && nodes) {
        for (const [nodeId, nodeData] of Object.entries(input.inputs)) {
          const node = nodes.find(n => n.id === nodeId);
          if (node) {
            node.data = { ...node.data, ...((nodeData as any) || {}) };
          }
        }
      }

      const flattenedVariables: Record<string, any> = {};
      if (input.variables) {
        for (const [label, fields] of Object.entries(input.variables)) {
          if (typeof fields === "object" && fields !== null) {
            for (const [field, value] of Object.entries(fields as Record<string, any>)) {
              flattenedVariables[`${label}.${field}`] = value;
            }
          } else {
            flattenedVariables[label] = fields;
          }
        }
      }

      console.log("[API DEBUG] executeWorkflow received input.variables:", input.variables);
      console.log("[API DEBUG] executeWorkflow flattenedVariables:", flattenedVariables);

      const res = await caller.workflow.execute({
        workflowId: workflow.id,
        nodes: nodes,
        edges: workflow.edges as any,
        inputValues: Object.keys(flattenedVariables).length > 0 ? flattenedVariables : undefined,
        webhookUrl: input.webhook?.url,
      });
      return {
        runId: res.runId,
        workflowId: res.workflowId,
        scope: res.scope,
        nodeCount: res.nodeCount,
        estimatedCredits: res.estimatedCredits,
      };
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
          .record(z.string(), z.record(z.string(), z.any()))
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
    .output(z.object({ runId: z.string(), workflowId: z.string(), scope: z.string(), nodeCount: z.number(), estimatedCredits: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const caller = appRouter.createCaller({ auth: { userId: ctx.apiUserId } as any, prisma: ctx.prisma, req: ctx.req });
      
      const workflow = await caller.workflow.load({ id: input.id });
      if (!workflow) throw new TRPCError({ code: "NOT_FOUND" });
      
      const nodes = workflow.nodes as any[];
      if (input.inputs && nodes) {
        for (const [nodeId, nodeData] of Object.entries(input.inputs)) {
          const node = nodes.find(n => n.id === nodeId);
          if (node) {
            node.data = { ...node.data, ...((nodeData as any) || {}) };
          }
        }
      }

      const flattenedVariables: Record<string, any> = {};
      if (input.variables) {
        for (const [label, fields] of Object.entries(input.variables)) {
          if (typeof fields === "object" && fields !== null) {
            for (const [field, value] of Object.entries(fields as Record<string, any>)) {
              flattenedVariables[`${label}.${field}`] = value;
            }
          } else {
            flattenedVariables[label] = fields;
          }
        }
      }

      const res = await caller.workflow.execute({
        workflowId: workflow.id,
        nodes: nodes,
        edges: workflow.edges as any,
        selectedNodeIds: input.selectedNodeIds,
        inputValues: Object.keys(flattenedVariables).length > 0 ? flattenedVariables : undefined,
        webhookUrl: input.webhook?.url,
      });
      
      return {
        runId: res.runId,
        workflowId: res.workflowId,
        scope: res.scope,
        nodeCount: res.nodeCount,
        estimatedCredits: res.estimatedCredits,
      };
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
      
      const createdAt = new Date((status as any).createdAt).getTime();
      const finishedAt = (status as any).finishedAt ? new Date((status as any).finishedAt).getTime() : undefined;
      const durationMs = finishedAt ? finishedAt - createdAt : undefined;
      
      return {
        id: status.id,
        status: status.status,
        scope: status.scope,
        nodeRuns: status.nodeRuns,
        durationMs,
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
