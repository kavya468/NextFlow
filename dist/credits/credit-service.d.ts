/**
 * Read the user's credit balance from the ledger.
 * NEVER reads from User.credits — always SUM(CreditLedger.delta).
 */
export declare function getBalance(userId: string): Promise<number>;
/**
 * Format a credit balance for display.
 * e.g. 1_500_000 → "1,500,000"
 */
export declare function formatCredits(credits: number): string;
/**
 * Estimate the total credit cost for a set of nodes before execution.
 * Returns both the total and per-node breakdown.
 */
export declare function estimateWorkflowCost(nodes: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
}>): Promise<{
    total: number;
    perNode: Array<{
        nodeId: string;
        nodeType: string;
        estimate: number;
    }>;
}>;
/**
 * Deduct actual credits after a node completes successfully.
 * Writes a single negative ledger entry with the real cost.
 * Called once per node after the provider returns.
 */
export declare function deductCredits(userId: string, runId: string, nodeRunId: string, amount: number, nodeType: string): Promise<void>;
