"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StatusQuerySchema = exports.LoadWorkflowQuerySchema = exports.SaveWorkflowSchema = exports.ExecuteWorkflowSchema = exports.EdgeSchema = exports.NodeSchema = void 0;
const zod_1 = require("zod");
exports.NodeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    type: zod_1.z.string(),
    position: zod_1.z.object({ x: zod_1.z.number(), y: zod_1.z.number() }),
    data: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
}).passthrough();
exports.EdgeSchema = zod_1.z.object({
    id: zod_1.z.string(),
    source: zod_1.z.string(),
    target: zod_1.z.string(),
    sourceHandle: zod_1.z.string().nullable().optional(),
    targetHandle: zod_1.z.string().nullable().optional(),
}).passthrough();
exports.ExecuteWorkflowSchema = zod_1.z.object({
    nodes: zod_1.z.array(exports.NodeSchema).min(1, "At least one node is required"),
    edges: zod_1.z.array(exports.EdgeSchema),
    workflowId: zod_1.z.string().optional(),
    selectedNodeIds: zod_1.z.array(zod_1.z.string()).optional(),
});
exports.SaveWorkflowSchema = zod_1.z.object({
    workflowId: zod_1.z.string().optional(),
    name: zod_1.z.string().max(100).optional(),
    nodes: zod_1.z.array(exports.NodeSchema),
    edges: zod_1.z.array(exports.EdgeSchema),
});
exports.LoadWorkflowQuerySchema = zod_1.z.object({
    id: zod_1.z.string().optional(),
});
exports.StatusQuerySchema = zod_1.z.object({
    runId: zod_1.z.string().min(1, "runId is required"),
});
