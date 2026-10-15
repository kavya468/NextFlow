// ============================================================================
// lib/services/edge-service.ts — Shared Edge Service Layer
// ============================================================================
//
// Pure business-logic functions for managing edges within a workflow's JSON
// edges array.  Consumed by BOTH the tRPC router and the HTTP MCP endpoint.
//
// Every mutation uses an interactive Prisma $transaction with SELECT FOR UPDATE
// to prevent lost-update race conditions on concurrent edits.
// ============================================================================

import { prisma } from "@/lib/db";
import {
  WorkflowNotFoundError,
  EdgeNotFoundError,
  NodeNotFoundError,
} from "@/lib/services/errors";

// ── Local Types ────────────────────────────────────────────────────────────

interface FlowNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  [key: string]: unknown;
}

interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string | null;
  target: string;
  targetHandle: string | null;
  [key: string]: unknown;
}

// ── 1. addEdge ─────────────────────────────────────────────────────────────

export async function addEdge(
  userId: string,
  workflowName: string,
  sourceLabel: string,
  targetLabel: string,
  sourceHandle?: string,
  targetHandle?: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Step 1: Find workflow by name + userId (no lock)
    const workflow = await tx.workflow.findFirst({
      where: {
        userId,
        name: { equals: workflowName, mode: "insensitive" },
      },
      select: { id: true, name: true, nodes: true, edges: true },
    });

    if (!workflow) {
      throw new WorkflowNotFoundError(workflowName);
    }

    // Step 2: Lock the workflow row to prevent concurrent modifications
    await tx.$queryRawUnsafe(
      `SELECT id FROM "Workflow" WHERE id = $1 FOR UPDATE`,
      workflow.id,
    );

    // Step 3: Re-read after lock
    const locked = await tx.workflow.findUnique({
      where: { id: workflow.id },
      select: { id: true, name: true, nodes: true, edges: true },
    });

    const nodes: FlowNode[] = Array.isArray(locked!.nodes)
      ? (locked!.nodes as FlowNode[])
      : [];

    let edges: FlowEdge[] = Array.isArray(locked!.edges)
      ? (locked!.edges as FlowEdge[])
      : [];

    // Step 4: Resolve sourceLabel → node ID (case-insensitive)
    const sourceNode = nodes.find(
      (n) =>
        typeof n.data.label === "string" &&
        n.data.label.toLowerCase() === sourceLabel.toLowerCase(),
    );
    if (!sourceNode) {
      throw new NodeNotFoundError(sourceLabel, workflow.name);
    }

    // Step 5: Resolve targetLabel → node ID (case-insensitive)
    const targetNode = nodes.find(
      (n) =>
        typeof n.data.label === "string" &&
        n.data.label.toLowerCase() === targetLabel.toLowerCase(),
    );
    if (!targetNode) {
      throw new NodeNotFoundError(targetLabel, workflow.name);
    }

    const sourceId = sourceNode.id;
    const targetId = targetNode.id;

    // Step 6: Check for duplicate — targetHandle already has an incoming edge
    if (targetHandle) {
      const duplicate = edges.find(
        (e) => e.target === targetId && e.targetHandle === targetHandle,
      );
      if (duplicate) {
        return {
          error: `Target handle '${targetHandle}' on node '${targetLabel}' already has an incoming edge (${duplicate.id}). Remove it first or use update.`,
        };
      }
    }

    // Step 7: Generate edge ID and create edge
    const edgeId = `e-${sourceId}-${targetId}-${Date.now()}`;
    const newEdge: FlowEdge = {
      id: edgeId,
      source: sourceId,
      sourceHandle: sourceHandle ?? null,
      target: targetId,
      targetHandle: targetHandle ?? null,
    };

    edges.push(newEdge);

    await tx.workflow.update({
      where: { id: workflow.id },
      data: { edges: edges as any, revision: { increment: 1 } },
    });

    return {
      edgeId,
      workflowId: workflow.id,
      workflowName: workflow.name,
      source: sourceId,
      target: targetId,
    };
  });

  return result;
}

// ── 2. deleteEdge ──────────────────────────────────────────────────────────

export async function deleteEdge(
  userId: string,
  workflowName: string,
  edgeId: string,
) {
  const result = await prisma.$transaction(async (tx) => {
    // Step 1: Find workflow by name + userId (no lock)
    const workflow = await tx.workflow.findFirst({
      where: {
        userId,
        name: { equals: workflowName, mode: "insensitive" },
      },
      select: { id: true, name: true, edges: true },
    });

    if (!workflow) {
      throw new WorkflowNotFoundError(workflowName);
    }

    // Step 2: Lock the workflow row to prevent concurrent modifications
    await tx.$queryRawUnsafe(
      `SELECT id FROM "Workflow" WHERE id = $1 FOR UPDATE`,
      workflow.id,
    );

    // Step 3: Re-read after lock
    const locked = await tx.workflow.findUnique({
      where: { id: workflow.id },
      select: { id: true, name: true, edges: true },
    });

    let edges: FlowEdge[] = Array.isArray(locked!.edges)
      ? (locked!.edges as FlowEdge[])
      : [];

    // Step 4: Find and remove edge by ID
    const before = edges.length;
    edges = edges.filter((e) => e.id !== edgeId);

    if (edges.length === before) {
      throw new EdgeNotFoundError(edgeId, workflow.name);
    }

    await tx.workflow.update({
      where: { id: workflow.id },
      data: { edges: edges as any, revision: { increment: 1 } },
    });

    return {
      deleted: true as const,
      workflowId: workflow.id,
      workflowName: workflow.name,
    };
  });

  return result;
}
