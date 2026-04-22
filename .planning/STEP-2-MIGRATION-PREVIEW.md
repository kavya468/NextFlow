# Step 2 — Prisma Schema Migration Preview

## ⚠️ Destructive Change Analysis

**NONE.** Every change below is additive:
- New nullable columns on existing tables (no data loss)
- New table (`CreditLedger`)
- New indexes (read-only optimization)

No columns dropped. No type changes. No renames.

## Changes Summary

### `Run` model (modified)
| Change | Type | Risk |
|--------|------|------|
| Add `completedAt DateTime?` | New nullable column | ✅ Safe — existing rows get NULL |
| Add `ledger CreditLedger[]` relation | Relation only (no column) | ✅ Safe |
| Add `@@index([userId, createdAt(sort: Desc)])` | New index | ✅ Safe |
| Add `@@index([workflowId])` | New index | ✅ Safe |

### `NodeRun` model (modified)
| Change | Type | Risk |
|--------|------|------|
| Add `providerUsed String?` | New nullable column | ✅ Safe |
| Add `creditsUsed Int?` | New nullable column | ✅ Safe |
| Add `@@index([runId, nodeId])` | New index | ✅ Safe |

### `CreditLedger` model (new)
| Change | Type | Risk |
|--------|------|------|
| Create entire table | New table | ✅ Safe |
| FK to `Run` on `workflowRunId` | New foreign key | ✅ Safe |
| Two composite indexes | New indexes | ✅ Safe |

## Equivalent Migration SQL

```sql
-- 1. Add completedAt to Run
ALTER TABLE "Run" ADD COLUMN "completedAt" TIMESTAMP(3);

-- 2. Add providerUsed and creditsUsed to NodeRun
ALTER TABLE "NodeRun" ADD COLUMN "providerUsed" TEXT;
ALTER TABLE "NodeRun" ADD COLUMN "creditsUsed" INTEGER;

-- 3. Create CreditLedger table
CREATE TABLE "CreditLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "nodeRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedger_pkey" PRIMARY KEY ("id")
);

-- 4. Add foreign key: CreditLedger.workflowRunId → Run.id
ALTER TABLE "CreditLedger"
    ADD CONSTRAINT "CreditLedger_workflowRunId_fkey"
    FOREIGN KEY ("workflowRunId") REFERENCES "Run"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Indexes for query performance
CREATE INDEX "Run_userId_createdAt_idx" ON "Run"("userId", "createdAt" DESC);
CREATE INDEX "Run_workflowId_idx" ON "Run"("workflowId");
CREATE INDEX "NodeRun_runId_nodeId_idx" ON "NodeRun"("runId", "nodeId");
CREATE INDEX "CreditLedger_userId_createdAt_idx" ON "CreditLedger"("userId", "createdAt" DESC);
CREATE INDEX "CreditLedger_workflowRunId_idx" ON "CreditLedger"("workflowRunId");
```

## Confirmation Required

This migration is **100% additive**. No data loss is possible.
Apply with `prisma db push` or `prisma migrate dev` after review.
