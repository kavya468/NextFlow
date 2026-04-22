import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  getBalance,
  formatCredits,
  estimateWorkflowCost,
} from "@/lib/credits/credit-service";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";

export const creditsRouter = createTRPCRouter({
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    const balance = await getBalance(ctx.auth.userId);
    return { balance, formatted: formatCredits(balance) };
  }),

  getHistory: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const items = await ctx.prisma.creditLedger.findMany({
        where: {
          userId: ctx.auth.userId,
          ...(input.cursor ? { id: { lt: input.cursor } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: input.limit + 1,
        select: {
          id: true,
          delta: true,
          reason: true,
          workflowRunId: true,
          nodeRunId: true,
          createdAt: true,
        },
      });

      let nextCursor: string | undefined;
      if (items.length > input.limit) {
        const next = items.pop();
        nextCursor = next?.id;
      }

      return { items, nextCursor };
    }),

  estimateWorkflow: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: input.workflowId },
        select: { nodes: true, userId: true },
      });

      if (!workflow || workflow.userId !== ctx.auth.userId) {
        return { total: 0, perNode: [] };
      }

      const nodes = (workflow.nodes as Array<{ id: string; type: string; data: Record<string, unknown> }>) ?? [];
      const result = await estimateWorkflowCost(nodes);
      return result;
    }),

  estimateNodes: protectedProcedure
    .input(
      z.object({
        nodes: z.array(
          z.object({
            id: z.string(),
            type: z.string(),
            data: z.record(z.string(), z.unknown()).default({}),
          })
        ),
      })
    )
    .query(async ({ input }) => {
      const result = await estimateWorkflowCost(input.nodes);
      return result;
    }),
});
