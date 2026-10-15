import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { auth } from "@trigger.dev/sdk";
import { 
  SaveWorkflowSchema, 
  LoadWorkflowQuerySchema, 
  ExecuteWorkflowSchema, 
  StatusQuerySchema 
} from "@/lib/schemas";
import { nodeRegistry } from "@/lib/nodes/registry";
import "@/lib/nodes/configs";
import { getExposedInputs, deduplicatePassthroughLabels } from "@/lib/nodes/exposed-inputs";

// ── Service Layer (shared with MCP) ────────────────────────────────────────
import { executeWorkflow, cloneWorkflow, requestRunCancellation, retryRunDispatch } from "@/lib/services/workflow-service";
import { estimateWorkflowCost } from "@/lib/credits/credit-service";
import { recoverRun } from "@/lib/services/run-recovery";
import {
  WorkflowNotFoundError,
  WorkflowConflictError,
  InsufficientCreditsError,
  ValidationError,
  OwnershipError,
  ExecutionNotFoundError,
  DuplicateLabelError,
} from "@/lib/services/errors";

// ── Domain Error → TRPCError Adapter ───────────────────────────────────────
export function translateServiceError(err: unknown): never {
  if (err instanceof WorkflowConflictError) throw new TRPCError({ code: "CONFLICT", message: err.message });
  if (err instanceof WorkflowNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  if (err instanceof InsufficientCreditsError) {
    throw new TRPCError({ code: "PAYMENT_REQUIRED", message: err.message });
  }
  if (err instanceof ValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof DuplicateLabelError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  if (err instanceof OwnershipError) {
    throw new TRPCError({ code: "FORBIDDEN", message: err.message });
  }
  if (err instanceof ExecutionNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : "Unknown error",
  });
}

// ── Realtime Token Minting (tRPC-specific, not in service layer) ───────────
async function mintRealtimeToken(triggerId: string): Promise<string | undefined> {
  try {
    return await auth.createPublicToken({
      scopes: { read: { runs: [triggerId] } },
      expirationTime: "15m",
    });
  } catch (tokenErr) {
    console.error("Failed to mint Trigger.dev public token:", tokenErr);
    return undefined;
  }
}

export const workflowRouter = createTRPCRouter({
  // 1. List all workflows
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const workflows = await ctx.prisma.workflow.findMany({
        where: { userId: ctx.auth.userId },
        select: { id: true, name: true, updatedAt: true, revision: true },
        orderBy: { updatedAt: "desc" },
      });
      return workflows;
    }),

  // 2. Load a single workflow by ID
  load: protectedProcedure
    .input(z.object({ id: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      if (!input.id) {
        return null;
      }
      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: input.id },
      });
      if (!workflow || workflow.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return workflow;
    }),

  // All editor writes compare the revision the editor actually loaded.
  save: protectedProcedure
    .input(SaveWorkflowSchema.extend({
      expectedRevision: z.number().int().nonnegative().optional(),
      creationId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const nodes = structuredClone(input.nodes);
      deduplicatePassthroughLabels(nodes, nodeRegistry);
      const workflow = await ctx.prisma.$transaction(async tx => {
        if (input.workflowId) {
          if (input.expectedRevision === undefined) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Reload this workflow before saving. Its saved revision is required." });
          const existing = await tx.workflow.findFirst({ where: { id: input.workflowId, userId: ctx.auth.userId } });
          if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
          const result = await tx.workflow.updateMany({
            where: { id: existing.id, userId: ctx.auth.userId, revision: input.expectedRevision },
            data: { name: input.name ?? existing.name, nodes: nodes as Prisma.InputJsonValue, edges: input.edges as Prisma.InputJsonValue, revision: { increment: 1 } },
          });
          if (!result.count) throw new TRPCError({ code: "CONFLICT", message: "This workflow changed in another session. Your local draft has been kept. Export it or reload the saved version." });
          return tx.workflow.findUniqueOrThrow({ where: { id: existing.id } });
        }
        await tx.user.createMany({ data: [{ id: ctx.auth.userId }], skipDuplicates: true });
        const data = { userId: ctx.auth.userId, name: input.name || "Untitled Workflow", nodes: nodes as Prisma.InputJsonValue, edges: input.edges as Prisma.InputJsonValue };
        if (input.creationId) await tx.workflow.createMany({ data: [{ id: input.creationId, ...data }], skipDuplicates: true });
        const created = input.creationId
          ? await tx.workflow.findUniqueOrThrow({ where: { id: input.creationId } })
          : await tx.workflow.create({ data });
        if (created.userId !== ctx.auth.userId) throw new TRPCError({ code: "NOT_FOUND" });
        if (created.revision !== 0) throw new TRPCError({ code: "CONFLICT", message: "This newly created workflow was changed in another session. Export your local draft before opening its saved version from the dashboard." });
        return created;
      });
      return { success: true, workflowId: workflow.id, revision: workflow.revision, workflow };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      expectedRevision: z.number().int().nonnegative(),
      name: SaveWorkflowSchema.shape.name,
      nodes: SaveWorkflowSchema.shape.nodes.optional(),
      edges: SaveWorkflowSchema.shape.edges.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const nodes = input.nodes === undefined ? undefined : structuredClone(input.nodes);
      if (nodes) deduplicatePassthroughLabels(nodes, nodeRegistry);
      return ctx.prisma.$transaction(async tx => {
        const existing = await tx.workflow.findFirst({ where: { id: input.id, userId: ctx.auth.userId } });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        const updated = await tx.workflow.updateMany({
          where: { id: input.id, userId: ctx.auth.userId, revision: input.expectedRevision },
          data: { name: input.name, nodes: nodes as Prisma.InputJsonValue, edges: input.edges as Prisma.InputJsonValue, revision: { increment: 1 } },
        });
        if (!updated.count) throw new TRPCError({ code: "CONFLICT", message: "This workflow changed in another session. Your local draft has been kept. Export it or reload the saved version." });
        return tx.workflow.findUniqueOrThrow({ where: { id: input.id } });
      });
    }),

  // 5. Execute a workflow
  //    Delegates to the shared service layer for validation, credit checks,
  //    Run/NodeRun creation, and Trigger.dev dispatch. Only UI-specific
  //    concerns (auto-create workflow, canvas save, realtime token) remain here.
  execute: protectedProcedure
    .input(ExecuteWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const workflowId = input.workflowId === "temp-visual-id" ? "" : input.workflowId ?? "";
        if (workflowId && input.expectedRevision === undefined) throw new ValidationError("Save and confirm the workflow revision before running");
        const result = await executeWorkflow(ctx.auth.userId, workflowId, {
          selectedNodeIds: input.selectedNodeIds,
          nodesOverride: workflowId ? undefined : input.nodes, edgesOverride: workflowId ? undefined : input.edges,
          inputValues: input.inputValues, webhookUrl: input.webhookUrl,
          requestKey: input.idempotencyKey, saveCanvas: !workflowId, expectedRevision: input.expectedRevision,
        });
        const publicAccessToken = result.publicAccessToken ?? (result.triggerId ? await mintRealtimeToken(result.triggerId) : undefined);
        return { ...result, runId: result.executionId, publicAccessToken };
      } catch (err) { translateServiceError(err); }
    }),

  retryDispatch: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await retryRunDispatch(ctx.auth.userId, input.runId);
        const publicAccessToken = result.publicAccessToken ?? (result.triggerId ? await mintRealtimeToken(result.triggerId) : undefined);
        return { ...result, runId: result.executionId, publicAccessToken };
      } catch (err) { translateServiceError(err); }
    }),

  recover: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try { return await recoverRun(ctx.auth.userId, input.runId); }
      catch (error) { translateServiceError(error); }
    }),

  // 5a. Mint a scoped public access token for Trigger.dev Realtime
  triggerToken: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.run.findUnique({
        where: { id: input.runId },
        select: { triggerId: true, userId: true },
      });

      if (!run || run.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (!run.triggerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Run has no associated Trigger.dev handle",
        });
      }

      const publicAccessToken = await auth.createPublicToken({
        scopes: {
          read: { runs: [run.triggerId] },
        },
        expirationTime: "15m",
      });

      return { publicAccessToken, triggerId: run.triggerId };
    }),

  // 5. Get workflow execution status
  status: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.run.findUnique({
        where: { id: input.runId },
        include: { nodeRuns: true },
      });
      if (!run || run.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      return run;
    }),

  // 6. Get user's run history
  history: protectedProcedure
    .input(z.object({ workflowId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const runs = await ctx.prisma.run.findMany({
        where: { userId: ctx.auth.userId, ...(input?.workflowId && { workflowId: input.workflowId }) },
        include: { nodeRuns: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
      return runs;
    }),

  // 7. Cancel a run
  cancel: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await requestRunCancellation(ctx.auth.userId, input.runId);
        return { success: result.status === "CANCELLED", status: result.status };
      } catch (err) { translateServiceError(err); }
    }),

  // 8. Delete a workflow
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Workflow" WHERE "id" = ${input.id} FOR UPDATE`;
        const workflow = await tx.workflow.findUnique({ where: { id: input.id } });
        if (!workflow || workflow.userId !== ctx.auth.userId) throw new TRPCError({ code: "NOT_FOUND" });
        const hasRuns = await tx.run.count({ where: { workflowId: input.id } });
        if (hasRuns) throw new TRPCError({ code: "CONFLICT", message: "This workflow has run history and cannot be deleted while accounting records depend on it." });
        await tx.workflow.delete({ where: { id: input.id } });
      });

      return { success: true };
    }),

  // 9. Duplicate a workflow
  duplicate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const original = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
      if (!original || original.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await ctx.prisma.user.upsert({
        where: { id: ctx.auth.userId },
        update: {},
        create: { id: ctx.auth.userId },
      });

      const duplicate = await ctx.prisma.workflow.create({
        data: {
          userId: ctx.auth.userId,
          name: `${original.name} (Copy)`,
          nodes: original.nodes as any,
          edges: original.edges as any,
        },
      });

      return { success: true, workflowId: duplicate.id };
    }),

  // Dashboard titles share the editor's optimistic revision boundary.
  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(100), expectedRevision: z.number().int().nonnegative() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.$transaction(async tx => {
        const existing = await tx.workflow.findFirst({ where: { id: input.id, userId: ctx.auth.userId } });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        const updated = await tx.workflow.updateMany({
          where: { id: input.id, userId: ctx.auth.userId, revision: input.expectedRevision },
          data: { name: input.name, revision: { increment: 1 } },
        });
        if (!updated.count) throw new TRPCError({ code: "CONFLICT", message: "This workflow changed in another session. Reload the saved title before renaming it." });
        return tx.workflow.findUniqueOrThrow({ where: { id: input.id } });
      });
      return { success: true, workflow };
    }),

  // 11. Get exposed (parameterizable) inputs for a workflow
  exposedInputs: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: input.workflowId },
        select: { nodes: true, userId: true },
      });
      if (!workflow || workflow.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }
      const nodes = Array.isArray(workflow.nodes)
        ? (workflow.nodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>)
        : [];
      const result = getExposedInputs(nodes, nodeRegistry);
      return { inputs: result.inputs, warnings: result.warnings };
    }),

  // 12. Browse published templates in the gallery
  gallery: protectedProcedure
    .input(z.object({
      category: z.enum(["all", "image", "video", "audio", "text"]).default("all"),
      sortBy: z.enum(["popular", "recent"]).default("popular"),
      search: z.string().optional(),
      limit: z.number().min(1).max(50).default(20),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { category = "all", sortBy = "popular", search, limit = 20, offset = 0 } = input ?? {};

      const where: any = { visibility: "published" };
      if (category !== "all") where.category = category;
      if (search) where.name = { contains: search, mode: "insensitive" };

      const orderBy = sortBy === "popular"
        ? { usageCount: "desc" as const }
        : { publishedAt: "desc" as const };

      const [templates, total] = await Promise.all([
        ctx.prisma.workflow.findMany({
          where,
          select: {
            id: true,
            name: true,
            description: true,
            thumbnail: true,
            category: true,
            usageCount: true,
            publishedAt: true,
            nodes: true,
            user: { select: { id: true } },
          },
          orderBy,
          take: limit,
          skip: offset,
        }),
        ctx.prisma.workflow.count({ where }),
      ]);

      return { templates, total };
    }),

  // 13. Publish a workflow to the gallery
  publish: protectedProcedure
    .input(z.object({
      id: z.string(),
      description: z.string().optional(),
      thumbnail: z.string().url().optional().or(z.literal("")),
      category: z.enum(["image", "video", "audio", "text"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
      if (!workflow || workflow.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return ctx.prisma.workflow.update({
        where: { id: input.id },
        data: {
          visibility: "published",
          description: input.description ?? workflow.description,
          thumbnail: input.thumbnail || null,
          category: input.category,
          publishedAt: new Date(),
        },
      });
    }),

  // 14. Unpublish a workflow (remove from gallery)
  unpublish: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
      if (!workflow || workflow.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      return ctx.prisma.workflow.update({
        where: { id: input.id },
        data: { visibility: "private", publishedAt: null },
      });
    }),

  // 15. Get template detail (for consumers who want to run it)
  templateDetail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          name: true,
          description: true,
          thumbnail: true,
          category: true,
          usageCount: true,
          publishedAt: true,
          visibility: true,
          nodes: true,
          edges: true,
          userId: true,
          user: { select: { id: true } },
        },
      });

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Allow access if: user owns it OR it's published
      const isOwner = workflow.userId === ctx.auth.userId;
      if (!isOwner && workflow.visibility !== "published") {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // Get exposed inputs for the form
      const nodes = Array.isArray(workflow.nodes)
        ? (workflow.nodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>)
        : [];

      const { inputs: exposedInputs, warnings: exposedInputWarnings } = getExposedInputs(nodes, nodeRegistry);

      // Compute per-category node breakdown for "What's Inside" UI
      const nodeBreakdown = nodes.reduce((acc, n) => {
        const config = nodeRegistry.get(n.type || "");
        const category = config?.category || "unknown";
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Estimate credit cost for pre-run transparency
      const costEstimate = await estimateWorkflowCost(
        nodes.map(n => ({ id: n.id, type: n.type || "unknown", data: n.data ?? {} }))
      );

      return {
        ...workflow,
        exposedInputs,
        exposedInputWarnings,
        isOwner,
        nodeBreakdown,
        totalNodes: nodes.length,
        estimatedCredits: costEstimate.total,
        costBreakdown: costEstimate.perNode,
      };
    }),

  // 16. Execute a published template with custom input values
  //     Delegates to the shared service layer. Only the template visibility
  //     check, usage count increment, and realtime token minting remain here.
  executeTemplate: protectedProcedure
    .input(z.object({
      workflowId: z.string(),
      idempotencyKey: z.string().min(1).max(128).optional(),
      values: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // ── tRPC-specific: verify template is published ────────────────────
      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: input.workflowId },
      });

      if (!workflow || workflow.visibility !== "published") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Template not found or not published" });
      }

      // ── Delegate to service layer ──────────────────────────────────────
      try {
        const result = await executeWorkflow(ctx.auth.userId, input.workflowId, {
          inputValues: input.values,
          requestKey: input.idempotencyKey,
          skipOwnershipCheck: true, // consumer ≠ owner
        });

        // Increment usage count (fire and forget)
        ctx.prisma.workflow.update({
          where: { id: workflow.id },
          data: { usageCount: { increment: 1 } },
        }).catch(() => {});

        // ── tRPC-specific: mint realtime token ───────────────────────────
        const publicAccessToken =
          result.publicAccessToken ?? (result.triggerId ? await mintRealtimeToken(result.triggerId) : undefined);

        return {
          runId: result.executionId,
          status: result.status,
          triggerId: result.triggerId,
          workflowId: workflow.id,
          estimatedCredits: result.estimatedCredits,
          publicAccessToken,
        };
      } catch (err) {
        translateServiceError(err);
      }
    }),

  // 17. Clone a published template into the user's own account
  cloneTemplate: protectedProcedure
    .input(z.object({ workflowId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const cloned = await cloneWorkflow(ctx.auth.userId, input.workflowId);
        return { id: cloned.id, name: cloned.name };
      } catch (err) {
        translateServiceError(err);
      }
    }),
});
