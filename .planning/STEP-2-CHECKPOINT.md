# Step 2 Checkpoint — Prisma Schema

## What Was Built

Additive Prisma schema evolution to support the credit ledger and execution 
metadata for the Seedream pipeline.

### Changes
- **`Run` model**: Added `completedAt DateTime?` for terminal status timestamp, 
  `CreditLedger[]` relation, and two composite indexes for history panel queries
- **`NodeRun` model**: Added `providerUsed String?` (e.g. "fal"), 
  `creditsUsed Int?` for actual cost tracking, and `@@index([runId, nodeId])`
- **`CreditLedger` model** (new): Full ledger with `userId`, `delta` (pos/neg), 
  `reason`, FK to `Run`, optional link to `NodeRun`, indexed for balance queries

### Destructive Changes: NONE
All additions are nullable columns, a new table, and new indexes.
Migration SQL preview written to `.planning/STEP-2-MIGRATION-PREVIEW.md`.

## Files Created / Modified

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | **MODIFIED** | Added CreditLedger, new fields on Run/NodeRun, indexes |
| `.planning/STEP-2-MIGRATION-PREVIEW.md` | **CREATED** | Migration SQL preview for review |

## Verification

```
prisma validate: ✅ "The schema is valid"
prisma generate: ✅ Client regenerated
tsc --noEmit:    ✅ Zero errors
```

## ⚠️ Database Push Not Run

The schema file is updated and Prisma client is regenerated, but `prisma db push` 
has NOT been executed. Run this manually when ready to apply to your database:

```bash
npx prisma db push
```

## Git Recommendation

```bash
git add -A && git commit -m "feat(db): add CreditLedger model, provider/credits fields on NodeRun

- CreditLedger: userId, delta, reason, FK to Run, indexed for balance queries
- Run: added completedAt, ledger relation, composite indexes
- NodeRun: added providerUsed, creditsUsed, index on [runId, nodeId]
- All changes additive (nullable columns, new table, new indexes)"
```

## Next Step

**Step 3: Webhook Route** — Create `/api/webhooks/fal/[token]/route.ts` with 
HMAC signature verification, `wait.completeToken()` delivery, and always-200 response.
