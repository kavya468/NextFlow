import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { Unkey } from "@unkey/api";

const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY || "" });

function getApiId(): string {
  const apiId = process.env.UNKEY_API_ID;
  if (!apiId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "UNKEY_API_ID is not configured. Set it in your .env.local file.",
    });
  }
  return apiId;
}

export const apiKeysRouter = createTRPCRouter({
  create: protectedProcedure
    .input(z.object({
      name: z.string(),
      description: z.string().optional(),
      rateLimit: z.object({
        limit: z.number().int().min(1).max(10000),
        duration: z.enum(["1m", "10m", "1h", "24h"]),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const apiId = getApiId();

      const durationMs: Record<string, number> = {
        "1m":  60_000,
        "10m": 600_000,
        "1h":  3_600_000,
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
              type: "fast" as const,
              limit: input.rateLimit.limit,
              duration: durationMs[input.rateLimit.duration],
            },
          }),
        });
        return { keyId: response.data.keyId, key: response.data.key };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create API key: ${e instanceof Error ? e.message : "Unknown error"}`,
          cause: e,
        });
      }
    }),

  list: protectedProcedure
    .input(z.void())
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
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list API keys: ${e instanceof Error ? e.message : "Unknown error"}`,
          cause: e,
        });
      }
    }),

  revoke: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const apiId = getApiId();
      try {
        const listResponse = await unkey.apis.listKeys({
          apiId,
          externalId: ctx.auth.userId,
        });
        if (!listResponse.data.some((k) => k.keyId === input.keyId)) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Key not found or unauthorized" });
        }

        await unkey.keys.deleteKey({ keyId: input.keyId });
        return { success: true };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to revoke API key: ${e instanceof Error ? e.message : "Unknown error"}`,
          cause: e,
        });
      }
    }),
});
