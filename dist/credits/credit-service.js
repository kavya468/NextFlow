"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBalance = getBalance;
exports.formatCredits = formatCredits;
exports.estimateWorkflowCost = estimateWorkflowCost;
exports.deductCredits = deductCredits;
const db_1 = require("@/lib/db");
const registry_1 = require("@/lib/nodes/registry");
// 1,000,000 credits = $1.00 provider cost
/**
 * Read the user's credit balance from the ledger.
 * NEVER reads from User.credits — always SUM(CreditLedger.delta).
 */
async function getBalance(userId) {
    const result = await db_1.prisma.creditLedger.aggregate({
        where: { userId },
        _sum: { delta: true },
    });
    return result._sum.delta ?? 0;
}
/**
 * Format a credit balance for display.
 * e.g. 1_500_000 → "1,500,000"
 */
function formatCredits(credits) {
    return credits.toLocaleString("en-US");
}
/**
 * Estimate the total credit cost for a set of nodes before execution.
 * Returns both the total and per-node breakdown.
 */
async function estimateWorkflowCost(nodes) {
    const perNode = [];
    let total = 0;
    for (const node of nodes) {
        if (!node.type)
            continue;
        const config = registry_1.nodeRegistry.get(node.type);
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
 * Deduct actual credits after a node completes successfully.
 * Writes a single negative ledger entry with the real cost.
 * Called once per node after the provider returns.
 */
async function deductCredits(userId, runId, nodeRunId, amount, nodeType) {
    if (amount <= 0)
        return;
    await db_1.prisma.creditLedger.create({
        data: {
            userId,
            delta: -amount,
            reason: `node:${nodeType}`,
            workflowRunId: runId,
            nodeRunId,
        },
    });
}
