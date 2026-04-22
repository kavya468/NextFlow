# Step 7 Checkpoint — Realtime Status + Canvas UI

## Status: COMPLETE

## Changes Made

### `lib/store.ts`
1. **`NodeRunStatus` type** — New union type: `"PENDING" | "RUNNING" | "SUCCESS" | "FAILED"`.
2. **`nodeRunStatuses`** — New state field: `Record<string, NodeRunStatus>` mapping node IDs to their execution status.
3. **`setNodeRunStatuses()`** — Action to batch-set all node statuses from polling.
4. **`clearNodeRunStatuses()`** — Action to reset statuses (called on cancel and 4s after terminal state).

### `components/canvas/ExecutionControls.tsx`
1. **Per-node status tracking** — Polling now builds a `statuses` map from `nodeRun` records and calls `setNodeRunStatuses()`.
2. **Delayed status clear** — On terminal state, statuses persist for 4 seconds so users see the final outcome, then auto-clear.
3. **Cancel clears statuses** — Immediate clear on successful cancel.
4. **Generic output mapping** — Replaced hardcoded `llm`/`crop`/`extract` output checks with a generic loop that writes `result_${key}` for every output key from any config-driven node. Legacy `result` and `result_url` keys preserved for backward compatibility.

### `components/nodes/GenericNode.tsx`
1. **Status indicators** — Added inline icons next to the node name:
   - `PENDING` → gray `Clock` icon
   - `RUNNING` → amber spinning `Loader2`
   - `SUCCESS` → green `CheckCircle2`
   - `FAILED` → red `XCircle`
2. **Status-based border colors** — Node border changes during execution:
   - Running: amber glow
   - Success: green glow (persists 4s after completion)
   - Failed: red glow (persists 4s)
   - Selected: blue (takes priority)
3. **Run Node button** — Small `Play` icon button in the header for non-passthrough nodes. Dispatches `nextflow:run-nodes` custom event (same mechanism as context menu), which `ExecutionControls` already listens for.
4. **Transition animation** — `transition-colors duration-300` on the border for smooth status changes.

## Architecture Notes

- **Polling remains primary** — The `publicAccessToken` (from Step 6) is returned for future Trigger.dev Realtime integration via `@trigger.dev/react-hooks`. Current implementation uses 2s polling which is reliable and doesn't require an additional package.
- **No new packages** — All UI changes use existing Lucide icons and Tailwind classes.
- **Config-agnostic** — The output mapping and status indicators work with any config-driven node, not just Seedream.

## Verification

- [x] TypeScript strict mode: clean compile
- [x] Vitest: 47/47 tests pass (no regressions)
- [x] Lints clean
- [x] No new dependencies required
