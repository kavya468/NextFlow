import { z } from "zod";



export const NodeSchema = z.object({
  id: z.string().min(1),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.string(), z.unknown()).default({}),
}).passthrough();

export const EdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
}).passthrough();



export const ExecuteWorkflowSchema = z.object({
  expectedRevision: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  nodes: z.array(NodeSchema).min(1, "At least one node is required"),
  edges: z.array(EdgeSchema),
  workflowId: z.string().optional(),
  selectedNodeIds: z.array(z.string()).optional(),
  inputValues: z.record(z.string(), z.unknown()).optional(),
  webhookUrl: z.string().url().optional(),
});

export type ExecuteWorkflowInput = z.infer<typeof ExecuteWorkflowSchema>;



export const SaveWorkflowSchema = z.object({
  workflowId: z.string().optional(),
  name: z.string().max(100).optional(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

export type SaveWorkflowInput = z.infer<typeof SaveWorkflowSchema>;



export const LoadWorkflowQuerySchema = z.object({
  id: z.string().optional(),
});



export const StatusQuerySchema = z.object({
  runId: z.string().min(1, "runId is required"),
});
