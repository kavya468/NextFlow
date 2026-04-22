# NextFlow Audit — Execution Tracker

## Day 1 — Security & Machine Sizing (Quick Wins)

### Machine Sizing
- [/] Change webhook-waitpoint tasks to `micro` or `small-1x`
  - [ ] `seedream.ts` — `large-2x` → `small-1x`
  - [ ] `elevenlabs.task.ts` — `large-2x` → `small-1x`
  - [ ] `kling.task.ts` — `large-2x` → `small-1x`
  - [ ] `seedance.task.ts` — `large-2x` → `small-1x`
  - [ ] `sync-lipsync.task.ts` — `large-2x` → `small-1x`
  - [ ] `openrouter.task.ts` — `large-2x` → `small-1x`
  - [ ] `llm.ts` — `large-2x` → `small-1x`
  - Keep `large-2x` for FFmpeg tasks (`media.ts`, `ffmpeg-*.task.ts`)
- [ ] Remove `DATABASE_URL` from `.mcp.json`
- [ ] Add auth to upload route

### Security
- [ ] Verify `.env.local` is in `.gitignore`
- [ ] Flag secrets rotation needed (user action)

## Day 2 — MCP Resources & Testing (TODO)
- [ ] Implement MCP resources
- [ ] Write orchestrator tests

## Day 3 — Credit Reservation & API Hardening (TODO)
## Day 4 — Orchestrator Optimization & Task Factory (TODO)
## Day 5 — Interview Rehearsal (TODO)
