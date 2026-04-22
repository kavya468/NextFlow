import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { getAuth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";
import { Unkey } from "@unkey/api";
import { OpenApiMeta } from "trpc-to-openapi";

const unkey = new Unkey({ rootKey: process.env.UNKEY_ROOT_KEY || "" });

export const createTRPCContext = async (opts: { req: NextRequest }) => {
  const auth = getAuth(opts.req);
  return {
    auth,
    prisma,
    req: opts.req,
  };
};

const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof Error ? error.cause.message : null,
      },
    };
  },
});

export const createOpenApiContext = async (opts: { req: NextRequest }) => {
  const authHeader = opts.req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" });
  }
  
  const token = authHeader.split(" ")[1];
  
  const response = await unkey.keys.verifyKey({ key: token });
  const verification = response.data;

  if (!verification.valid || !verification.identity?.externalId) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
  }
  
  return {
    apiUserId: verification.identity.externalId,
    prisma,
    req: opts.req,
  };
};

const tApi = initTRPC.meta<OpenApiMeta>().context<typeof createOpenApiContext>().create({
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof Error ? error.cause.message : null,
      },
    };
  },
});

export const createPublicApiRouter = tApi.router;
export const publicApiProcedure = tApi.procedure.use(({ ctx, next }) => {
  if (!ctx.apiUserId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: { ...ctx, apiUserId: ctx.apiUserId },
  });
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth.userId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({
    ctx: {
      auth: { ...ctx.auth, userId: ctx.auth.userId },
    },
  });
});
