"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.protectedProcedure = exports.publicProcedure = exports.createTRPCRouter = exports.publicApiProcedure = exports.createPublicApiRouter = exports.createOpenApiContext = exports.createTRPCContext = void 0;
const server_1 = require("@trpc/server");
const superjson_1 = __importDefault(require("superjson"));
const server_2 = require("@clerk/nextjs/server");
const db_1 = require("@/lib/db");
const api_1 = require("@unkey/api");
const unkey = new api_1.Unkey({ rootKey: process.env.UNKEY_ROOT_KEY || "" });
const createTRPCContext = async (opts) => {
    const auth = (0, server_2.getAuth)(opts.req);
    return {
        auth,
        prisma: db_1.prisma,
        req: opts.req,
    };
};
exports.createTRPCContext = createTRPCContext;
const t = server_1.initTRPC.context().create({
    transformer: superjson_1.default,
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
const createOpenApiContext = async (opts) => {
    const authHeader = opts.req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
        throw new server_1.TRPCError({ code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" });
    }
    const token = authHeader.split(" ")[1];
    const response = await unkey.keys.verifyKey({ key: token });
    const verification = response.data;
    if (!verification.valid || !verification.identity?.externalId) {
        throw new server_1.TRPCError({ code: "UNAUTHORIZED", message: "Invalid API key" });
    }
    return {
        apiUserId: verification.identity.externalId,
        prisma: db_1.prisma,
        req: opts.req,
    };
};
exports.createOpenApiContext = createOpenApiContext;
const tApi = server_1.initTRPC.meta().context().create({
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
exports.createPublicApiRouter = tApi.router;
exports.publicApiProcedure = tApi.procedure.use(({ ctx, next }) => {
    if (!ctx.apiUserId) {
        throw new server_1.TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
        ctx: { ...ctx, apiUserId: ctx.apiUserId },
    });
});
exports.createTRPCRouter = t.router;
exports.publicProcedure = t.procedure;
exports.protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.auth.userId) {
        throw new server_1.TRPCError({ code: "UNAUTHORIZED" });
    }
    return next({
        ctx: {
            auth: { ...ctx.auth, userId: ctx.auth.userId },
        },
    });
});
