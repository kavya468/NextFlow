"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appRouter = void 0;
const trpc_1 = require("./trpc");
const workflow_1 = require("./routers/workflow");
const credits_1 = require("./routers/credits");
const apiKeys_1 = require("./routers/apiKeys");
exports.appRouter = (0, trpc_1.createTRPCRouter)({
    workflow: workflow_1.workflowRouter,
    credits: credits_1.creditsRouter,
    apiKeys: apiKeys_1.apiKeysRouter,
});
