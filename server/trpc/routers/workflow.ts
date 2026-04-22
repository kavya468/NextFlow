import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { runs, auth } from "@trigger.dev/sdk/v3";
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
import { executeWorkflow, cloneWorkflow } from "@/lib/services/workflow-service";
import { estimateWorkflowCost } from "@/lib/credits/credit-service";
import {
  WorkflowNotFoundError,
  InsufficientCreditsError,
  ValidationError,
  OwnershipError,
  ExecutionNotFoundError,
  DuplicateLabelError,
} from "@/lib/services/errors";

// ── Domain Error → TRPCError Adapter ───────────────────────────────────────
function translateServiceError(err: unknown): never {
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
        select: { id: true, name: true, updatedAt: true },
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

  // 3. Save a workflow
  save: protectedProcedure
    .input(SaveWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      const { workflowId, name, nodes, edges } = input;
      let workflow;

      // ── Auto-deduplicate passthrough labels before persisting ────────
      // Prevents the duplicate-label bug where the orchestrator's Step 0
      // applies a single override to ALL matching nodes silently.
      const mutableNodes = nodes ? [...(nodes as any[])] : [];
      if (mutableNodes.length > 0) {
        deduplicatePassthroughLabels(
          mutableNodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>,
          nodeRegistry,
        );
      }

      if (workflowId) {
        const existing = await ctx.prisma.workflow.findUnique({ where: { id: workflowId } });
        if (existing?.userId !== ctx.auth.userId) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        workflow = await ctx.prisma.workflow.update({
          where: { id: workflowId },
          data: {
            name: name || existing.name,
            nodes: mutableNodes as any,
            edges: edges as any,
          },
        });
      } else {
        await ctx.prisma.user.upsert({
          where: { id: ctx.auth.userId },
          update: {},
          create: { id: ctx.auth.userId },
        });

        workflow = await ctx.prisma.workflow.create({
          data: {
            userId: ctx.auth.userId,
            name: name || "Untitled Workflow",
            nodes: mutableNodes as any,
            edges: edges as any,
          },
        });
      }

      return { success: true, workflowId: workflow.id };
    }),

  // 4. Lightweight update (auto-save + inline name edit)
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      nodes: z.array(z.any()).optional(),
      edges: z.array(z.any()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const wf = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
      if (!wf || wf.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const data: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) data.name = input.name;
      if (input.edges !== undefined) data.edges = input.edges;

      // ── Auto-deduplicate passthrough labels on update ────────────────
      if (input.nodes !== undefined) {
        const mutableNodes = [...(input.nodes as any[])];
        deduplicatePassthroughLabels(
          mutableNodes as Array<{ id: string; type?: string; data: Record<string, unknown> }>,
          nodeRegistry,
        );
        data.nodes = mutableNodes;
      }

      return ctx.prisma.workflow.update({
        where: { id: input.id },
        data,
      });
    }),

  // 5. Execute a workflow
  //    Delegates to the shared service layer for validation, credit checks,
  //    Run/NodeRun creation, and Trigger.dev dispatch. Only UI-specific
  //    concerns (auto-create workflow, canvas save, realtime token) remain here.
  execute: protectedProcedure
    .input(ExecuteWorkflowSchema)
    .mutation(async ({ ctx, input }) => {
      const { nodes, edges, selectedNodeIds, workflowId: inputWorkflowId, inputValues, webhookUrl } = input;

      // ── tRPC-specific: auto-create or save workflow ────────────────────
      let finalWorkflowId = inputWorkflowId;
      if (!finalWorkflowId || finalWorkflowId === "temp-visual-id") {
        await ctx.prisma.user.upsert({
          where: { id: ctx.auth.userId },
          update: {},
          create: { id: ctx.auth.userId },
        });
        const workflow = await ctx.prisma.workflow.create({
          data: {
            userId: ctx.auth.userId,
            name: "Untitled Workflow",
            nodes: nodes as any,
            edges: edges as any,
          },
        });
        finalWorkflowId = workflow.id;
      } else {
        // Save current canvas state before execution
        await ctx.prisma.workflow.update({
          where: { id: finalWorkflowId },
          data: { nodes: nodes as any, edges: edges as any },
        });
      }

      // ── Delegate to service layer ──────────────────────────────────────
      try {
        const result = await executeWorkflow(ctx.auth.userId, finalWorkflowId, {
          selectedNodeIds: selectedNodeIds ?? undefined,
          nodesOverride: nodes,
          edgesOverride: edges,
          inputValues,
          webhookUrl,
        });

        // ── tRPC-specific: mint realtime token ───────────────────────────
        // Primary: SDK v4 may return a token on the handle directly.
        // Fallback: manually mint via auth.createPublicToken.
        const publicAccessToken =
          result.publicAccessToken ?? await mintRealtimeToken(result.triggerId);

        return {
          runId: result.executionId,
          triggerId: result.triggerId,
          workflowId: finalWorkflowId,
          scope: result.scope,
          nodeCount: result.nodeCount,
          estimatedCredits: result.estimatedCredits,
          publicAccessToken,
        };
      } catch (err) {
        translateServiceError(err);
      }
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
    .query(async ({ ctx }) => {
      const runs = await ctx.prisma.run.findMany({
        where: { userId: ctx.auth.userId },
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
      const run = await ctx.prisma.run.findUnique({
        where: { id: input.runId },
      });
      if (!run || run.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (run.triggerId) {
        try {
          await runs.cancel(run.triggerId);
        } catch (e) {
          console.error("Failed to cancel in trigger.dev", e);
        }
      }

      await ctx.prisma.run.update({
        where: { id: input.runId },
        data: { status: "FAILED" },
      });

      await ctx.prisma.nodeRun.updateMany({
        where: { runId: input.runId, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "FAILED", error: "Cancelled by user" },
      });
      return { success: true };
    }),

  // 8. Delete a workflow
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
      if (!workflow || workflow.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      await ctx.prisma.nodeRun.deleteMany({
        where: { run: { workflowId: input.id } },
      });
      await ctx.prisma.run.deleteMany({ where: { workflowId: input.id } });
      await ctx.prisma.workflow.delete({ where: { id: input.id } });

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

  // 10. Rename a workflow
  rename: protectedProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
      if (!workflow || workflow.userId !== ctx.auth.userId) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const updated = await ctx.prisma.workflow.update({
        where: { id: input.id },
        data: { name: input.name.trim() },
      });

      return { success: true, workflow: updated };
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
          skipOwnershipCheck: true, // consumer ≠ owner
        });

        // Increment usage count (fire and forget)
        ctx.prisma.workflow.update({
          where: { id: workflow.id },
          data: { usageCount: { increment: 1 } },
        }).catch(() => {});

        // ── tRPC-specific: mint realtime token ───────────────────────────
        const publicAccessToken =
          result.publicAccessToken ?? await mintRealtimeToken(result.triggerId);

        return {
          runId: result.executionId,
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
