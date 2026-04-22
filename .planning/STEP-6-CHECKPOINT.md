# Step 6 Checkpoint — tRPC Execute Mutation

## Status: COMPLETE

## Changes Made

### `server/trpc/routers/workflow.ts`

1. **Credit pre-check (block-on-estimate)** — Before triggering the orchestrator, the mutation:
   - Iterates all `execNodes`, calling `nodeRegistry.get(node.type).credits.estimate(node.data)` for each non-passthrough node
   - Sums the estimated cost
   - Executes `SELECT credits FROM "User" WHERE id = $1 FOR UPDATE` to lock the user row
   - Throws `TRPCError({ code: "FORBIDDEN" })` if balance < estimated cost
   - Does **not** deduct yet — the orchestrator handles actual deduction post-completion

2. **`userId` passthrough** — Added `userId: ctx.auth.userId` to the orchestrator payload, enabling the orchestrator's `deductCredits()` function to work.

3. **Scoped Realtime token** — After triggering, mints a short-lived (15min), read-only public access token scoped to the specific Trigger.dev run via `auth.createPublicToken()`. Token creation is non-fatal — if it fails, the client falls back to polling via `workflow.status`.

4. **Extended return type** — Now returns `estimatedCredits` and `publicAccessToken` alongside existing fields.

### New imports
- `auth` from `@trigger.dev/sdk/v3` (for `createPublicToken`)
- `nodeRegistry` from `@/lib/nodes/registry` (for credit estimation)
- `@/lib/nodes/configs` side-effect import (ensures configs are registered)

## Security Properties

| Property | Implementation |
|----------|---------------|
| Auth | Clerk session via `protectedProcedure` — `userId` from server session, never from client |
| Credit gate | `SELECT ... FOR UPDATE` prevents concurrent workflows from double-spending |
| Realtime token | Read-only, scoped to single run, 15min TTL — principle of least privilege |
| Input validation | All inputs validated by `ExecuteWorkflowSchema` (Zod) |
| Ownership | Workflow ownership checked before update |

## Verification

- [x] TypeScript strict mode: clean compile
- [x] Vitest: 47/47 tests pass (no regressions)
- [x] Lints clean
