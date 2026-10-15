// ============================================================================
// lib/services/node-service.ts — Shared Node Service Layer
// ============================================================================
//
// Pure business-logic functions for managing nodes within a workflow's JSON
// nodes array.  Consumed by BOTH the tRPC router and the HTTP MCP endpoint.
//
// Every mutation uses an interactive Prisma $transaction with SELECT FOR UPDATE
// to prevent lost-update race conditions on concurrent edits.
// ============================================================================

import { prisma } from "@/lib/db";
import {
  WorkflowNotFoundError,
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
  target: string;
  [key: string]: unknown;
}

// ── 1. addNode ─────────────────────────────────────────────────────────────

export async function addNode(
  userId: string,
  workflowName: string,
  nodeType: string,
  label?: string,
  config?: Record<string, unknown>,
  position?: { x: number; y: number },
) {
  const result = await prisma.$transaction(async (tx) => {
    // Step 1: Find workflow by name + userId (no lock)
    const workflow = await tx.workflow.findFirst({
      where: {
        userId,
        name: { equals: workflowName, mode: "insensitive" },
      },
      select: { id: true, name: true, nodes: true },
    });

    if (!workflow) {
      throw new WorkflowNotFoundError(workflowName);
    }

    // Step 2: Lock the workflow row to prevent concurrent modifications
    await tx.$queryRawUnsafe(
      `SELECT id FROM "Workflow" WHERE id = $1 FOR UPDATE`,
      workflow.id,
    );

    // Step 3: Re-read and modify
    const locked = await tx.workflow.findUnique({
      where: { id: workflow.id },
      select: { id: true, name: true, nodes: true },
    });

    const nodes: FlowNode[] = Array.isArray(locked!.nodes)
      ? (locked!.nodes as FlowNode[])
      : [];

    const nodeId = `${nodeType}-${Date.now()}`;
    const newNode: FlowNode = {
      id: nodeId,
      type: nodeType,
      position: position ?? { x: 100, y: 100 },
      data: {
        type: nodeType,
        label: label ?? nodeType,
        ...config,
      },
    };

    nodes.push(newNode);

    await tx.workflow.update({
      where: { id: workflow.id },
      data: { nodes: nodes as any, revision: { increment: 1 } },
    });

    return { nodeId, workflowId: workflow.id, workflowName: workflow.name };
  });

  return result;
}

// ── 2. updateNode ──────────────────────────────────────────────────────────

export async function updateNode(
  userId: string,
  workflowName: string,
  nodeLabel: string,
  updates: {
    label?: string;
    nodeType?: string;
    config?: Record<string, unknown>;
    position?: { x: number; y: number };
  },
) {
  const result = await prisma.$transaction(async (tx) => {
    // Step 1: Find workflow by name + userId (no lock)
    const workflow = await tx.workflow.findFirst({
      where: {
        userId,
        name: { equals: workflowName, mode: "insensitive" },
      },
      select: { id: true, name: true, nodes: true },
    });

    if (!workflow) {
      throw new WorkflowNotFoundError(workflowName);
    }

    // Step 2: Lock the workflow row to prevent concurrent modifications
    await tx.$queryRawUnsafe(
      `SELECT id FROM "Workflow" WHERE id = $1 FOR UPDATE`,
      workflow.id,
    );

    // Step 3: Re-read and modify
    const locked = await tx.workflow.findUnique({
      where: { id: workflow.id },
      select: { id: true, name: true, nodes: true },
    });

    const nodes: FlowNode[] = Array.isArray(locked!.nodes)
      ? (locked!.nodes as FlowNode[])
      : [];

    const nodeIdx = nodes.findIndex(
      (n) => (n.data.label as string) === nodeLabel,
    );

    if (nodeIdx === -1) {
      throw new NodeNotFoundError(nodeLabel, workflowName);
    }

    // Apply updates to the found node
    if (updates.position) {
      nodes[nodeIdx].position = updates.position;
    }
    if (updates.label) {
      nodes[nodeIdx].data.label = updates.label;
    }
    if (updates.nodeType) {
      nodes[nodeIdx].type = updates.nodeType;
      nodes[nodeIdx].data.type = updates.nodeType;
    }
    if (updates.config) {
      nodes[nodeIdx].data = { ...nodes[nodeIdx].data, ...updates.config };
    }

    await tx.workflow.update({
      where: { id: workflow.id },
      data: { nodes: nodes as any, revision: { increment: 1 } },
    });

    return {
      nodeId: nodes[nodeIdx].id,
      workflowId: workflow.id,
      workflowName: workflow.name,
    };
  });

  return result;
}

// ── 3. deleteNode ──────────────────────────────────────────────────────────

export async function deleteNode(
  userId: string,
  workflowName: string,
  nodeLabel: string,
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

    // Step 3: Re-read and modify
    const locked = await tx.workflow.findUnique({
      where: { id: workflow.id },
      select: { id: true, name: true, nodes: true, edges: true },
    });

    let nodes: FlowNode[] = Array.isArray(locked!.nodes)
      ? (locked!.nodes as FlowNode[])
      : [];

    let edges: FlowEdge[] = Array.isArray(locked!.edges)
      ? (locked!.edges as FlowEdge[])
      : [];

    // Find the node to delete by label
    const targetNode = nodes.find(
      (n) => (n.data.label as string) === nodeLabel,
    );

    if (!targetNode) {
      throw new NodeNotFoundError(nodeLabel, workflowName);
    }

    // Remove the node
    nodes = nodes.filter((n) => n.id !== targetNode.id);

    // Remove any edges connected to the deleted node
    edges = edges.filter(
      (e) => e.source !== targetNode.id && e.target !== targetNode.id,
    );

    await tx.workflow.update({
      where: { id: workflow.id },
      data: {
        nodes: nodes as any,
        edges: edges as any,
        revision: { increment: 1 },
      },
    });

    return {
      deleted: true as const,
      workflowId: workflow.id,
      workflowName: workflow.name,
    };
  });

  return result;
}
