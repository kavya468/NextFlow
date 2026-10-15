import { prisma } from "@/lib/db";
import { nodeRegistry } from "@/lib/nodes/registry";
import { Prisma } from "@prisma/client";
import {
  ExecutionNotFoundError,
  InsufficientCreditsError,
  OwnershipError,
  ValidationError,
} from "@/lib/services/errors";

// 1,000,000 credits = $1.00 provider cost
const MAX_CREDITS = 2_147_483_647;
const TERMINAL_STATUSES = ["SUCCESS", "PARTIAL", "FAILED", "CANCELLED"];

export function validateCreditAmount(amount: number, label = "Credit amount"): number {
  if (!Number.isInteger(amount) || amount < 0 || amount > MAX_CREDITS) {
    throw new ValidationError(`${label} must be an integer between 0 and ${MAX_CREDITS}`);
  }
  return amount;
}

/**
 * Read the user's credit balance from the ledger.
 * NEVER reads from User.credits — always SUM(CreditLedger.delta).
 */
export async function getBalance(userId: string): Promise<number> {
  const result = await prisma.creditLedger.aggregate({
    where: { userId },
    _sum: { delta: true },
  });
  return result._sum.delta ?? 0;
}

/**
 * Format a credit balance for display.
 * e.g. 1_500_000 → "1,500,000"
 */
export function formatCredits(credits: number): string {
  return credits.toLocaleString("en-US");
}

/**
 * Estimate the total credit cost for a set of nodes before execution.
 * Returns both the total and per-node breakdown.
 */
export async function estimateWorkflowCost(
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>
): Promise<{
  total: number;
  perNode: Array<{ nodeId: string; nodeType: string; estimate: number }>;
}> {
  const perNode: Array<{ nodeId: string; nodeType: string; estimate: number }> = [];
  let total = 0;

  for (const node of nodes) {
    if (!node.type) continue;
    const config = nodeRegistry.get(node.type);
    if (!config || config.isPassthrough) {
      perNode.push({ nodeId: node.id, nodeType: node.type, estimate: 0 });
      continue;
    }
    const estimate = validateCreditAmount(config.credits.estimate(node.data ?? {}), `Estimate for ${node.id}`);
    perNode.push({ nodeId: node.id, nodeType: node.type, estimate });
    total = validateCreditAmount(total + estimate, "Workflow estimate");
  }

  return { total, perNode };
}

async function lockRun(tx: Prisma.TransactionClient, userId: string, runId: string) {
  // The account row exists even before its first ledger entry; always lock account before run.
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Run" WHERE id = ${runId} FOR UPDATE`;
  const run = await tx.run.findUnique({ where: { id: runId } });
  if (!run) throw new ExecutionNotFoundError(runId);
  if (run.userId !== userId) throw new OwnershipError();
  if (run.accountingVersion !== 1) {
    throw new ValidationError("Legacy execution requires reconciliation before accounting changes");
  }
  return run;
}

/** Reserve once; node usage is recorded separately and never debits the ledger again. */
export async function reserveCredits(
  userId: string,
  runId: string,
  estimatedAmount: number,
  transaction?: Prisma.TransactionClient,
): Promise<{ reserved: number; remainingBalance: number }> {
  validateCreditAmount(estimatedAmount, "Reservation");
  const reserve = async (tx: Prisma.TransactionClient) => {
    const run = await lockRun(tx, userId, runId);
    const operationKey = `run:${runId}:reserve`;
    const existing = await tx.creditLedger.findUnique({ where: { operationKey } });
    const result = await tx.creditLedger.aggregate({ where: { userId }, _sum: { delta: true } });
    const balance = result._sum.delta ?? 0;
    if (!Number.isSafeInteger(balance)) throw new ValidationError("Credit balance exceeds the supported range");

    if (existing) {
      if (existing.userId !== userId || existing.delta !== -estimatedAmount || run.reservedCredits !== estimatedAmount) {
        throw new ValidationError("Execution already has a different reservation");
      }
      return { reserved: estimatedAmount, remainingBalance: balance };
    }
    if (run.settledAt || TERMINAL_STATUSES.includes(run.status)) {
      throw new ValidationError("Cannot reserve credits for a completed execution");
    }
    if (estimatedAmount > 0 && balance < estimatedAmount) {
      throw new InsufficientCreditsError(estimatedAmount, balance);
    }

    await tx.creditLedger.create({
      data: {
        userId,
        delta: -estimatedAmount,
        reason: "reserve:run",
        workflowRunId: runId,
        operationKey,
      },
    });
    await tx.run.update({ where: { id: runId }, data: { reservedCredits: estimatedAmount } });
    return { reserved: estimatedAmount, remainingBalance: balance - estimatedAmount };
  };
  return transaction ? reserve(transaction) : prisma.$transaction(reserve);
}

function jsonValue(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : JSON.parse(JSON.stringify(value));
}

/** Persist successful output and its usage together; duplicate/late results do not change billing. */
export async function recordNodeResult(
  userId: string,
  runId: string,
  nodeId: string,
  result: {
    inputs?: unknown;
    outputs: unknown;
    providerUsed?: string;
    creditsUsed: number;
    durationMs?: number;
  },
): Promise<{ recorded: boolean; creditsUsed: number }> {
  validateCreditAmount(result.creditsUsed, "Node usage");
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, userId, runId);
    const nodes = await tx.nodeRun.findMany({ where: { runId, nodeId } });
    if (nodes.length !== 1) throw new ValidationError("Execution must contain exactly one matching node");
    const node = nodes[0];
    if (run.settledAt || TERMINAL_STATUSES.includes(run.status) || !["PENDING", "RUNNING"].includes(node.status)) {
      return { recorded: false, creditsUsed: node.creditsUsed };
    }
    await tx.nodeRun.update({
      where: { id: node.id },
      data: {
        status: "SUCCESS",
        error: null,
        ...(result.inputs !== undefined && { inputs: jsonValue(result.inputs) }),
        outputs: jsonValue(result.outputs),
        providerUsed: result.providerUsed,
        creditsUsed: result.creditsUsed,
        durationMs: result.durationMs,
      },
    });
    return { recorded: true, creditsUsed: result.creditsUsed };
  });
}

export type TerminalRunStatus = "SUCCESS" | "PARTIAL" | "FAILED" | "CANCELLED";

/** Settle from persisted successful usage, absorbing overages above the reservation. */
export async function finalizeRun(
  userId: string,
  runId: string,
  status: TerminalRunStatus,
  details: { error?: string; durationMs?: number; terminalNodeStatus?: "FAILED" | "CANCELLED"; requireUnclaimed?: boolean; expectedRecoveryAttempt?: number } = {},
): Promise<{ status: string; reserved: number; actual: number; charged: number; refunded: number; settled: boolean }> {
  return prisma.$transaction(async (tx) => {
    const run = await lockRun(tx, userId, runId);
    const reserved = validateCreditAmount(run.reservedCredits, "Stored reservation");
    const nodes = await tx.nodeRun.findMany({ where: { runId }, select: { status: true, creditsUsed: true } });
    const actual = nodes.reduce((total, node) => total + (node.status === "SUCCESS" ? validateCreditAmount(node.creditsUsed, "Stored node usage") : 0), 0);
    if (!Number.isSafeInteger(actual)) throw new ValidationError("Total node usage exceeds the supported range");
    if (run.settledAt) {
      if (run.chargedCredits === null) throw new ValidationError("Settled execution has no recorded charge");
      const charged = validateCreditAmount(run.chargedCredits, "Stored charge");
      if (charged > reserved) throw new ValidationError("Stored charge exceeds the reservation");
      return { status: run.status, reserved, actual, charged, refunded: reserved - charged, settled: false };
    }
    if (details.expectedRecoveryAttempt !== undefined && run.recoveryAttempt !== details.expectedRecoveryAttempt) {
      throw new ValidationError("Execution recovery generation has changed");
    }
    if (details.requireUnclaimed && run.workerId) {
      throw new ValidationError("Cannot release a reservation after a worker has claimed execution");
    }
    if (nodes.some((node) => node.status === "RUNNING")) {
      throw new ValidationError("Cannot settle while node execution is unresolved");
    }
    if (status === "SUCCESS" && nodes.some((node) => node.status !== "SUCCESS")) {
      throw new ValidationError("Cannot complete an execution with unfinished or failed nodes");
    }
    const reservation = await tx.creditLedger.findUnique({ where: { operationKey: `run:${runId}:reserve` } });
    if (!reservation || reservation.userId !== userId || reservation.delta !== -reserved) {
      throw new ValidationError("Execution reservation is missing or inconsistent");
    }
    const charged = Math.min(actual, reserved);
    const refunded = reserved - charged;
    await tx.creditLedger.create({
      data: {
        userId,
        delta: refunded,
        reason: "settle:refund",
        workflowRunId: runId,
        operationKey: `run:${runId}:settle`,
      },
    });
    if (details.terminalNodeStatus) {
      await tx.nodeRun.updateMany({
        where: { runId, status: "PENDING" },
        data: { status: details.terminalNodeStatus, error: details.error },
      });
    }
    const completedAt = new Date();
    await tx.run.update({
      where: { id: runId },
      data: { status, chargedCredits: charged, settledAt: completedAt, completedAt, durationMs: details.durationMs },
    });
    return { status, reserved, actual, charged, refunded, settled: true };
  });
}
