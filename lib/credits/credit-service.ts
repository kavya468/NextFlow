import { prisma } from "@/lib/db";
import { nodeRegistry } from "@/lib/nodes/registry";
import type { NodeConfig } from "@/lib/nodes/types";

// 1,000,000 credits = $1.00 provider cost

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
    const estimate = config.credits.estimate(node.data ?? {});
    perNode.push({ nodeId: node.id, nodeType: node.type, estimate });
    total += estimate;
  }

  return { total, perNode };
}

/**
 * Atomically reserve credits for a workflow run using SELECT FOR UPDATE.
 *
 * This prevents the TOCTOU race condition where multiple concurrent runs
 * all pass a non-locked balance check and collectively overdraw the account.
 *
 * Flow:
 *   1. Lock the user's ledger rows with FOR UPDATE (serializes concurrent checks)
 *   2. Compute current balance within the lock
 *   3. If sufficient, write a negative "reserve:run" entry immediately
 *   4. Return the remaining balance
 *
 * The reservation is later settled by `settleCredits()` which refunds the
 * difference between the estimated reserve and the actual cost.
 */
export async function reserveCredits(
  userId: string,
  runId: string,
  estimatedAmount: number,
): Promise<{ reserved: number; remainingBalance: number }> {
  if (estimatedAmount <= 0) {
    const balance = await getBalance(userId);
    return { reserved: 0, remainingBalance: balance };
  }

  return prisma.$transaction(async (tx) => {
    // Acquire an advisory-style lock by locking the user's ledger rows.
    // This serializes all concurrent credit checks for the same user.
    // NOTE: FOR UPDATE cannot be combined with aggregate functions in
    // PostgreSQL, so we lock first, then compute the balance separately.
    await tx.$queryRaw`
      SELECT 1
      FROM "CreditLedger"
      WHERE "userId" = ${userId}
      FOR UPDATE
    `;

    const result: Array<{ balance: number }> = await tx.$queryRaw`
      SELECT COALESCE(SUM(delta), 0)::int as balance
      FROM "CreditLedger"
      WHERE "userId" = ${userId}
    `;

    const balance = result[0]?.balance ?? 0;

    if (balance < estimatedAmount) {
      // Import is circular-safe because this is a runtime throw, not a module dep
      const { InsufficientCreditsError } = await import("@/lib/services/errors");
      throw new InsufficientCreditsError(estimatedAmount, balance);
    }

    // Immediately write a reserve entry — credits are now "held"
    await tx.creditLedger.create({
      data: {
        userId,
        delta: -estimatedAmount,
        reason: `reserve:run`,
        workflowRunId: runId,
      },
    });

    return {
      reserved: estimatedAmount,
      remainingBalance: balance - estimatedAmount,
    };
  });
}

/**
 * Settle a credit reservation after a workflow run completes.
 *
 * Compares the reserved amount (written by `reserveCredits`) against the
 * actual credits consumed (sum of per-node deductions). If the actual cost
 * is less than the reservation, a positive "settle:refund" entry is written
 * to return the difference to the user.
 *
 * If actual cost exceeds the estimate (unlikely but possible with variable
 * pricing), the overage is absorbed — we never charge more than consumed.
 */
export async function settleCredits(
  userId: string,
  runId: string,
  reservedAmount: number,
  actualAmount: number,
): Promise<{ refunded: number }> {
  const overpayment = reservedAmount - actualAmount;

  if (overpayment <= 0) {
    // Actual cost matched or exceeded estimate — nothing to refund
    return { refunded: 0 };
  }

  // Refund the difference
  await prisma.creditLedger.create({
    data: {
      userId,
      delta: overpayment,
      reason: `settle:refund`,
      workflowRunId: runId,
    },
  });

  return { refunded: overpayment };
}

/**
 * Deduct actual credits after a node completes successfully.
 * Writes a single negative ledger entry with the real cost.
 * Called once per node after the provider returns.
 *
 * NOTE: With the reserve/settle pattern, these per-node deductions are
 * tracked for reconciliation but the credits were already held upfront
 * by `reserveCredits()`. The orchestrator calls `settleCredits()` at
 * the end to refund any difference.
 */
export async function deductCredits(
  userId: string,
  runId: string,
  nodeRunId: string,
  amount: number,
  nodeType: string
): Promise<void> {
  if (amount <= 0) return;

  await prisma.creditLedger.create({
    data: {
      userId,
      delta: -amount,
      reason: `node:${nodeType}`,
      workflowRunId: runId,
      nodeRunId,
    },
  });
}
