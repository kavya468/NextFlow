import { createHash } from "node:crypto";
import { z } from "zod";
import { NodeSchema, EdgeSchema } from "../schemas";
import { ValidationError } from "./errors";

const snapshotSchema = z.object({
  contractVersion: z.number().int(),
  nodes: z.array(NodeSchema).min(1).max(200),
  edges: z.array(EdgeSchema).max(1000),
  inputValues: z.record(z.string(), z.unknown()).optional(),
  webhookUrl: z.string().optional(),
  nodeVersions: z.record(z.string(), z.string()),
  estimates: z.object({ perNode: z.array(z.object({ nodeId: z.string(), estimate: z.number().int().nonnegative() })) }),
});

export function readExecutionSnapshot(value: unknown) {
  const parsed = snapshotSchema.safeParse(value);
  if (!parsed.success) throw new ValidationError("The saved execution snapshot is invalid; its reservation needs review");
  return parsed.data;
}

export function nodeRecoveryTag(runId: string, nodeId: string) {
  return `nextflow-node:${createHash("sha256").update(JSON.stringify([runId, nodeId])).digest("hex").slice(0, 48)}`;
}

export function executionOutcome(statuses: string[], cancelled: boolean) {
  if (cancelled) return "CANCELLED" as const;
  if (statuses.every(status => status === "SUCCESS")) return "SUCCESS" as const;
  return statuses.includes("SUCCESS") ? "PARTIAL" as const : "FAILED" as const;
}
