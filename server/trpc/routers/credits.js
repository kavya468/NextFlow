"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditsRouter = void 0;
const zod_1 = require("zod");
const trpc_1 = require("../trpc");
const credit_service_1 = require("@/lib/credits/credit-service");
require("@/lib/nodes/configs");
exports.creditsRouter = (0, trpc_1.createTRPCRouter)({
    getBalance: trpc_1.protectedProcedure.query(async ({ ctx }) => {
        const balance = await (0, credit_service_1.getBalance)(ctx.auth.userId);
        return { balance, formatted: (0, credit_service_1.formatCredits)(balance) };
    }),
    getHistory: trpc_1.protectedProcedure
        .input(zod_1.z.object({
        limit: zod_1.z.number().min(1).max(100).default(20),
        cursor: zod_1.z.string().optional(),
    }))
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
        let nextCursor;
        if (items.length > input.limit) {
            const next = items.pop();
            nextCursor = next?.id;
        }
        return { items, nextCursor };
    }),
    estimateWorkflow: trpc_1.protectedProcedure
        .input(zod_1.z.object({ workflowId: zod_1.z.string() }))
        .query(async ({ ctx, input }) => {
        const workflow = await ctx.prisma.workflow.findUnique({
            where: { id: input.workflowId },
            select: { nodes: true, userId: true },
        });
        if (!workflow || workflow.userId !== ctx.auth.userId) {
            return { total: 0, perNode: [] };
        }
        const nodes = workflow.nodes ?? [];
        const result = await (0, credit_service_1.estimateWorkflowCost)(nodes);
        return result;
    }),
    estimateNodes: trpc_1.protectedProcedure
        .input(zod_1.z.object({
        nodes: zod_1.z.array(zod_1.z.object({
            id: zod_1.z.string(),
            type: zod_1.z.string(),
            data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
        })),
    }))
        .query(async ({ input }) => {
        const result = await (0, credit_service_1.estimateWorkflowCost)(input.nodes);
        return result;
    }),
});
