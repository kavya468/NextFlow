# Step 5 Checkpoint — Orchestrator Credit Deduction

## Status: COMPLETE

## Changes Made

### `src/trigger/orchestrator.ts`
1. **Payload extended** — Added `userId: string` to the orchestrator payload type. The tRPC mutation (Step 6) will pass this from the Clerk session.
2. **Credit deduction on success** — After each async node completes successfully, the orchestrator:
   - Calls `nodeRegistry.calculateCredits(nodeType, inputs, rawOutput)` to compute actual cost from the provider response
   - Calls `deductCredits()` with a Postgres `SELECT ... FOR UPDATE` transaction
   - Logs the deduction or a non-fatal error if DB fails
3. **`deductCredits()` helper** — New function implementing the atomic credit deduction:
   - `SELECT credits FROM "User" WHERE id = $1 FOR UPDATE` — row-level lock
   - Warns (but proceeds) if balance goes negative (race between tRPC pre-check and deduction)
   - Decrements `User.credits` and creates a `CreditLedger` entry in the same transaction
4. **`updateNodeRun()` extended** — Now accepts optional `providerUsed` and `creditsUsed` parameters, written to the `NodeRun` row on success.
5. **`updateRunStatus()` extended** — Sets `completedAt` timestamp when status is terminal (`SUCCESS`, `FAILED`, `PARTIAL`).
6. **`layerMeta` extended** — Tracks `providerId` alongside `endpointId` for credit attribution.

### `prisma/schema.prisma`
1. **`User.credits`** — Added `credits Int @default(0)` field (microcredit balance, 1,000,000 = $1.00).
2. **`User.ledger`** — Added `CreditLedger[]` relation.
3. **`CreditLedger.user`** — Added `User` relation via `userId`.

## Credit Flow (End-to-End)

```
tRPC mutation (Step 6)
  ├── SELECT credits FOR UPDATE → check estimate ≤ balance (soft gate)
  ├── Trigger orchestrator (don't await)
  └── Return { workflowRunId, triggerId }

Orchestrator (this step)
  ├── For each successful async node:
  │   ├── calculateCredits(nodeType, inputs, rawOutput) → actual cost
  │   └── deductCredits() → Postgres txn:
  │       ├── SELECT credits FOR UPDATE (row lock)
  │       ├── User.credits -= actual cost
  │       └── CreditLedger.create({ delta: -actual, reason, runId, nodeRunId })
  └── On failure: no credits deducted (zero-cost failures)
```

## Design Decisions

| Decision | Choice | Reasoning |
|----------|--------|-----------|
| When to deduct | Post-completion | Avoids phantom credit loss on task crash |
| Negative balance | Warn + proceed | tRPC pre-check is soft gate; don't fail the orchestrator |
| Credit failure | Non-fatal | DB outage shouldn't crash a successful generation |
| Lock strategy | `SELECT ... FOR UPDATE` | Prevents double-spend across concurrent workflows |

## Verification

- [x] TypeScript strict mode: clean compile
- [x] Vitest: 47/47 tests pass (no regressions)
- [x] Prisma client regenerated with new User.credits field
- [x] Lints clean
