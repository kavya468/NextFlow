"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowRouter = void 0;
const zod_1 = require("zod");
const trpc_1 = require("../trpc");
const server_1 = require("@trpc/server");
const v3_1 = require("@trigger.dev/sdk/v3");
const schemas_1 = require("@/lib/schemas");
const registry_1 = require("@/lib/nodes/registry");
require("@/lib/nodes/configs");
const credit_service_1 = require("@/lib/credits/credit-service");
const exposed_inputs_1 = require("@/lib/nodes/exposed-inputs");
exports.workflowRouter = (0, trpc_1.createTRPCRouter)({
    // 1. List all workflows
    list: trpc_1.protectedProcedure
        .query(async ({ ctx }) => {
        const workflows = await ctx.prisma.workflow.findMany({
            where: { userId: ctx.auth.userId },
            select: { id: true, name: true, updatedAt: true },
            orderBy: { updatedAt: "desc" },
        });
        return workflows;
    }),
    // 2. Load a single workflow by ID
    load: trpc_1.protectedProcedure
        .input(zod_1.z.object({ id: zod_1.z.string().optional() }))
        .query(async ({ ctx, input }) => {
        if (!input.id) {
            return null;
        }
        const workflow = await ctx.prisma.workflow.findUnique({
            where: { id: input.id },
        });
        if (!workflow || workflow.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        return workflow;
    }),
    // 3. Save a workflow
    save: trpc_1.protectedProcedure
        .input(schemas_1.SaveWorkflowSchema)
        .mutation(async ({ ctx, input }) => {
        const { workflowId, name, nodes, edges } = input;
        let workflow;
        if (workflowId) {
            const existing = await ctx.prisma.workflow.findUnique({ where: { id: workflowId } });
            if (existing?.userId !== ctx.auth.userId) {
                throw new server_1.TRPCError({ code: "FORBIDDEN" });
            }
            workflow = await ctx.prisma.workflow.update({
                where: { id: workflowId },
                data: {
                    name: name || existing.name,
                    nodes: nodes,
                    edges: edges,
                },
            });
        }
        else {
            await ctx.prisma.user.upsert({
                where: { id: ctx.auth.userId },
                update: {},
                create: { id: ctx.auth.userId },
            });
            workflow = await ctx.prisma.workflow.create({
                data: {
                    userId: ctx.auth.userId,
                    name: name || "Untitled Workflow",
                    nodes: nodes,
                    edges: edges,
                },
            });
        }
        return { success: true, workflowId: workflow.id };
    }),
    // 4. Lightweight update (auto-save + inline name edit)
    update: trpc_1.protectedProcedure
        .input(zod_1.z.object({
        id: zod_1.z.string(),
        name: zod_1.z.string().optional(),
        nodes: zod_1.z.array(zod_1.z.any()).optional(),
        edges: zod_1.z.array(zod_1.z.any()).optional(),
    }))
        .mutation(async ({ ctx, input }) => {
        const wf = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
        if (!wf || wf.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "FORBIDDEN" });
        }
        const data = { updatedAt: new Date() };
        if (input.name !== undefined)
            data.name = input.name;
        if (input.nodes !== undefined)
            data.nodes = input.nodes;
        if (input.edges !== undefined)
            data.edges = input.edges;
        return ctx.prisma.workflow.update({
            where: { id: input.id },
            data,
        });
    }),
    // 5. Execute a workflow
    execute: trpc_1.protectedProcedure
        .input(schemas_1.ExecuteWorkflowSchema)
        .mutation(async ({ ctx, input }) => {
        const { nodes, edges, selectedNodeIds, workflowId: inputWorkflowId } = input;
        let scope = "FULL";
        let execNodes = nodes.filter((n) => n.type !== "note");
        let execEdges = edges;
        if (selectedNodeIds && selectedNodeIds.length > 0) {
            scope = selectedNodeIds.length === 1 ? "SINGLE" : "PARTIAL";
            const selectedSet = new Set(selectedNodeIds);
            const visited = new Set();
            function gatherUpstream(nodeId) {
                if (visited.has(nodeId))
                    return;
                visited.add(nodeId);
                selectedSet.add(nodeId);
                for (const edge of edges) {
                    if (edge.target === nodeId) {
                        gatherUpstream(edge.source);
                    }
                }
            }
            for (const nid of selectedNodeIds)
                gatherUpstream(nid);
            execNodes = nodes.filter((n) => selectedSet.has(n.id));
            execEdges = edges.filter((e) => selectedSet.has(e.source) && selectedSet.has(e.target));
        }
        // Ensure the User row exists before any credit operations
        await ctx.prisma.user.upsert({
            where: { id: ctx.auth.userId },
            update: {},
            create: { id: ctx.auth.userId },
        });
        // ── Zero-Trust Node Input Validation ────────────────────────────────
        // Validate every node's inputs against its registry schema BEFORE
        // touching the database or deducting credits. Uses .partial() because
        // required fields may be wired from upstream edges at runtime — we
        // only validate the TYPES of values the client actually provided.
        const validationErrors = [];
        for (const node of execNodes) {
            if (!node.type) {
                validationErrors.push(`Node "${node.id}": missing type`);
                continue;
            }
            if (!registry_1.nodeRegistry.has(node.type)) {
                validationErrors.push(`Node "${node.id}": unknown type "${node.type}"`);
                continue;
            }
            const schema = registry_1.nodeRegistry.getInputSchema(node.type);
            const result = schema.partial().safeParse(node.data ?? {});
            if (!result.success) {
                const issues = result.error.issues
                    .map((iss) => `${iss.path.join(".")}: ${iss.message}`)
                    .join("; ");
                validationErrors.push(`Node "${node.id}" (${node.type}): ${issues}`);
            }
        }
        if (validationErrors.length > 0) {
            throw new server_1.TRPCError({
                code: "BAD_REQUEST",
                message: `Workflow validation failed:\n${validationErrors.join("\n")}`,
            });
        }
        // ── Credit Pre-Check (block-on-estimate) ──────────────────────────
        // Estimate total cost from all non-passthrough nodes in the execution
        // set, then verify the user has sufficient balance.
        // Balance is ALWAYS read from SUM(CreditLedger.delta), never User.credits.
        const costEstimate = await (0, credit_service_1.estimateWorkflowCost)(execNodes.map((n) => ({
            id: n.id,
            type: n.type || "unknown",
            data: n.data ?? {},
        })));
        const estimatedCredits = costEstimate.total;
        if (estimatedCredits > 0) {
            const balance = await (0, credit_service_1.getBalance)(ctx.auth.userId);
            if (balance < estimatedCredits) {
                throw new server_1.TRPCError({
                    code: "FORBIDDEN",
                    message: `Insufficient credits. Need ${estimatedCredits.toLocaleString()}, have ${balance.toLocaleString()}.`,
                });
            }
        }
        let finalWorkflowId = inputWorkflowId;
        if (!finalWorkflowId || finalWorkflowId === "temp-visual-id") {
            const workflow = await ctx.prisma.workflow.create({
                data: {
                    userId: ctx.auth.userId,
                    name: "Untitled Workflow",
                    nodes: nodes,
                    edges: edges,
                },
            });
            finalWorkflowId = workflow.id;
        }
        else {
            await ctx.prisma.workflow.update({
                where: { id: finalWorkflowId },
                data: { nodes: nodes, edges: edges },
            });
        }
        const startTime = Date.now();
        const run = await ctx.prisma.run.create({
            data: {
                userId: ctx.auth.userId,
                workflowId: finalWorkflowId,
                scope,
                status: "RUNNING",
            },
        });
        for (const node of execNodes) {
            await ctx.prisma.nodeRun.create({
                data: {
                    runId: run.id,
                    nodeId: node.id,
                    nodeType: node.type || "unknown",
                    status: "PENDING",
                },
            });
        }
        const handle = await v3_1.tasks.trigger("orchestrate-workflow", {
            runId: run.id,
            userId: ctx.auth.userId,
            nodes: execNodes,
            edges: execEdges,
            startTime,
        }, {
            tags: [`run:${run.id}`],
        });
        await ctx.prisma.run.update({
            where: { id: run.id },
            data: { triggerId: handle.id },
        });
        // ── Mint Scoped Public Token for Client-Side Realtime ─────────────
        // Try the handle's built-in token first (v4 SDK), then fall back to
        // auth.createPublicToken for manual minting.
        let publicAccessToken;
        publicAccessToken = handle.publicAccessToken;
        if (!publicAccessToken) {
            try {
                publicAccessToken = await v3_1.auth.createPublicToken({
                    scopes: {
                        read: { runs: [handle.id] },
                    },
                    expirationTime: "15m",
                });
            }
            catch (tokenErr) {
                console.error("Failed to mint Trigger.dev public token:", tokenErr);
            }
        }
        return {
            runId: run.id,
            triggerId: handle.id,
            workflowId: finalWorkflowId,
            scope,
            nodeCount: execNodes.length,
            estimatedCredits,
            publicAccessToken,
        };
    }),
    // 5a. Mint a scoped public access token for Trigger.dev Realtime
    triggerToken: trpc_1.protectedProcedure
        .input(zod_1.z.object({ runId: zod_1.z.string() }))
        .query(async ({ ctx, input }) => {
        const run = await ctx.prisma.run.findUnique({
            where: { id: input.runId },
            select: { triggerId: true, userId: true },
        });
        if (!run || run.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        if (!run.triggerId) {
            throw new server_1.TRPCError({
                code: "PRECONDITION_FAILED",
                message: "Run has no associated Trigger.dev handle",
            });
        }
        const publicAccessToken = await v3_1.auth.createPublicToken({
            scopes: {
                read: { runs: [run.triggerId] },
            },
            expirationTime: "15m",
        });
        return { publicAccessToken, triggerId: run.triggerId };
    }),
    // 5. Get workflow execution status
    status: trpc_1.protectedProcedure
        .input(zod_1.z.object({ runId: zod_1.z.string() }))
        .query(async ({ ctx, input }) => {
        const run = await ctx.prisma.run.findUnique({
            where: { id: input.runId },
            include: { nodeRuns: true },
        });
        if (!run || run.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        return run;
    }),
    // 6. Get user's run history
    history: trpc_1.protectedProcedure
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
    cancel: trpc_1.protectedProcedure
        .input(zod_1.z.object({ runId: zod_1.z.string() }))
        .mutation(async ({ ctx, input }) => {
        const run = await ctx.prisma.run.findUnique({
            where: { id: input.runId },
        });
        if (!run || run.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        if (run.triggerId) {
            try {
                await v3_1.runs.cancel(run.triggerId);
            }
            catch (e) {
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
    delete: trpc_1.protectedProcedure
        .input(zod_1.z.object({ id: zod_1.z.string() }))
        .mutation(async ({ ctx, input }) => {
        const workflow = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
        if (!workflow || workflow.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        await ctx.prisma.nodeRun.deleteMany({
            where: { run: { workflowId: input.id } },
        });
        await ctx.prisma.run.deleteMany({ where: { workflowId: input.id } });
        await ctx.prisma.workflow.delete({ where: { id: input.id } });
        return { success: true };
    }),
    // 9. Duplicate a workflow
    duplicate: trpc_1.protectedProcedure
        .input(zod_1.z.object({ id: zod_1.z.string() }))
        .mutation(async ({ ctx, input }) => {
        const original = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
        if (!original || original.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
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
                nodes: original.nodes,
                edges: original.edges,
            },
        });
        return { success: true, workflowId: duplicate.id };
    }),
    // 10. Rename a workflow
    rename: trpc_1.protectedProcedure
        .input(zod_1.z.object({ id: zod_1.z.string(), name: zod_1.z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
        const workflow = await ctx.prisma.workflow.findUnique({ where: { id: input.id } });
        if (!workflow || workflow.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        const updated = await ctx.prisma.workflow.update({
            where: { id: input.id },
            data: { name: input.name.trim() },
        });
        return { success: true, workflow: updated };
    }),
    // 11. Get exposed (parameterizable) inputs for a workflow
    exposedInputs: trpc_1.protectedProcedure
        .input(zod_1.z.object({ workflowId: zod_1.z.string() }))
        .query(async ({ ctx, input }) => {
        const workflow = await ctx.prisma.workflow.findUnique({
            where: { id: input.workflowId },
            select: { nodes: true, userId: true },
        });
        if (!workflow || workflow.userId !== ctx.auth.userId) {
            throw new server_1.TRPCError({ code: "NOT_FOUND" });
        }
        const nodes = Array.isArray(workflow.nodes)
            ? workflow.nodes
            : [];
        return (0, exposed_inputs_1.getExposedInputs)(nodes, registry_1.nodeRegistry);
    }),
});
