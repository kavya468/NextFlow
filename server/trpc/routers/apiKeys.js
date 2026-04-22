"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeysRouter = void 0;
const zod_1 = require("zod");
const server_1 = require("@trpc/server");
const trpc_1 = require("../trpc");
const api_1 = require("@unkey/api");
const unkey = new api_1.Unkey({ rootKey: process.env.UNKEY_ROOT_KEY || "" });
function getApiId() {
    const apiId = process.env.UNKEY_API_ID;
    if (!apiId) {
        throw new server_1.TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "UNKEY_API_ID is not configured. Set it in your .env.local file.",
        });
    }
    return apiId;
}
exports.apiKeysRouter = (0, trpc_1.createTRPCRouter)({
    create: trpc_1.protectedProcedure
        .input(zod_1.z.object({
        name: zod_1.z.string(),
        description: zod_1.z.string().optional(),
        rateLimit: zod_1.z.object({
            limit: zod_1.z.number().int().min(1).max(10000),
            duration: zod_1.z.enum(["1m", "10m", "1h", "24h"]),
        }).optional(),
    }))
        .mutation(async ({ ctx, input }) => {
        const apiId = getApiId();
        const durationMs = {
            "1m": 60_000,
            "10m": 600_000,
            "1h": 3_600_000,
            "24h": 86_400_000,
        };
        try {
            const response = await unkey.keys.createKey({
                apiId,
                prefix: "nf",
                externalId: ctx.auth.userId,
                name: input.name,
                meta: { description: input.description },
                ...(input.rateLimit && {
                    ratelimit: {
                        type: "fast",
                        limit: input.rateLimit.limit,
                        duration: durationMs[input.rateLimit.duration],
                    },
                }),
            });
            return { keyId: response.data.keyId, key: response.data.key };
        }
        catch (e) {
            if (e instanceof server_1.TRPCError)
                throw e;
            throw new server_1.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to create API key: ${e instanceof Error ? e.message : "Unknown error"}`,
                cause: e,
            });
        }
    }),
    list: trpc_1.protectedProcedure
        .input(zod_1.z.void())
        .query(async ({ ctx }) => {
        const apiId = getApiId();
        try {
            const response = await unkey.apis.listKeys({
                apiId,
                externalId: ctx.auth.userId,
            });
            return response.data.map((k) => ({
                keyId: k.keyId,
                name: k.name || "Unnamed Key",
                createdAt: new Date(k.createdAt),
                lastUsed: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
                requestCount: 0,
                maskedKey: `${k.start}••••••••`,
            }));
        }
        catch (e) {
            if (e instanceof server_1.TRPCError)
                throw e;
            throw new server_1.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to list API keys: ${e instanceof Error ? e.message : "Unknown error"}`,
                cause: e,
            });
        }
    }),
    revoke: trpc_1.protectedProcedure
        .input(zod_1.z.object({ keyId: zod_1.z.string() }))
        .mutation(async ({ ctx, input }) => {
        const apiId = getApiId();
        try {
            const listResponse = await unkey.apis.listKeys({
                apiId,
                externalId: ctx.auth.userId,
            });
            if (!listResponse.data.some((k) => k.keyId === input.keyId)) {
                throw new server_1.TRPCError({ code: "NOT_FOUND", message: "Key not found or unauthorized" });
            }
            await unkey.keys.deleteKey({ keyId: input.keyId });
            return { success: true };
        }
        catch (e) {
            if (e instanceof server_1.TRPCError)
                throw e;
            throw new server_1.TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to revoke API key: ${e instanceof Error ? e.message : "Unknown error"}`,
                cause: e,
            });
        }
    }),
});
