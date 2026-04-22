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
          .record(z.string(), z.unknown())
          .optional()
          .meta({
            description:
              "Dynamic inputs mapped by node ID to override original graph values.",
            examples: [
              {
                node_1: { prompt: "A futuristic cityscape at sunset" },
              },
            ],
          }),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .meta({
            description:
              "Dynamic inputs mapped by human-readable label to override exposed inputs.",
            examples: [{ Prompt: "A futuristic cityscape at sunset" }],
          }),
        webhookUrl: z.string().url().optional().meta({
          description: "Optional webhook URL to receive a POST request upon completion.",
        }),
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

      const res = await caller.workflow.execute({
        workflowId: workflow.id,
        nodes: nodes,
        edges: workflow.edges as any,
        inputValues: input.variables,
        webhookUrl: input.webhookUrl,
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
          .record(z.string(), z.unknown())
          .optional()
          .meta({
            description:
              "Dynamic inputs mapped by node ID to override original graph values.",
            examples: [
              {
                node_4: { image_url: "https://example.com/asset.png" },
              },
            ],
          }),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .meta({
            description:
              "Dynamic inputs mapped by human-readable label to override exposed inputs.",
            examples: [{ Prompt: "A futuristic cityscape at sunset" }],
          }),
        webhookUrl: z.string().url().optional().meta({
          description: "Optional webhook URL to receive a POST request upon completion.",
        }),
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

      const res = await caller.workflow.execute({
        workflowId: workflow.id,
        nodes: nodes,
        edges: workflow.edges as any,
        selectedNodeIds: input.selectedNodeIds,
        inputValues: input.variables,
        webhookUrl: input.webhookUrl,
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
