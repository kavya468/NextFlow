# 🧠 MEMORY.md — Persistent AI Context & Architectural Source of Truth

---

> **⚠️ AI DIRECTIVE — READ THIS FIRST**
>
> You **MUST** read this entire `MEMORY.md` file before executing any new task,
> writing any code, or proposing any architectural change. This document is the
> single source of truth for the NextFlow hackathon project.
>
> **After completing any task**, you are required to append:
> - New bug fixes to the **Bug Fixes Log** section
> - Architectural decisions to the **Architectural Rules** section
> - Completed milestones to the **Progress Log** section
>
> Failure to consult this file before acting will result in contradictory code,
> duplicated work, and broken invariants. Do not skip this step.

---

## 1. Project Context & Stack

**NextFlow** is a visual AI workflow builder (Krea-style node editor) being developed for a 10-day hackathon. Users connect AI models, media tools, and utilities into executable DAG pipelines on a React Flow canvas.

### Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | **Next.js 16** (App Router, Turbopack) | `app/` directory, server components |
| API | **tRPC v11** + **superjson** | Type-safe RPC, no REST endpoints |
| Auth | **Clerk** | `@clerk/nextjs`, middleware-based |
| Database | **Neon PostgreSQL** + **Prisma** (driver adapters) | Serverless, connection pooling |
| Orchestration | **Trigger.dev v4** | Cloud-hosted, `triggerAndPoll` + `batchTriggerAndWait` |
| Canvas | **React Flow** (`@xyflow/react`) | Custom nodes, edges, DAG validation |
| State | **Zustand** | Single store with undo/redo history |
| UI Components | **shadcn/ui** + **Tailwind CSS v4** | Dark theme, Suisse Intl font |
| Package Manager | **pnpm** | Strict dependency resolution |

### Key Files

| File | Purpose |
|------|---------|
| `lib/nodes/types.ts` | `NodeConfig` interface — the DNA schema for every node |
| `lib/nodes/registry.ts` | `NodeRegistry` singleton — Zod schemas, endpoint resolution, palette |
| `lib/nodes/configs/*.ts` | One config file per node type |
| `components/nodes/GenericNode.tsx` | Universal renderer — replaces ALL individual node components |
| `src/trigger/orchestrator.ts` | DAG executor — dispatches to Trigger.dev tasks |
| `server/trpc/routers/workflow.ts` | All workflow CRUD + execution tRPC procedures |
| `lib/store.ts` | Zustand store — nodes, edges, undo/redo, running state |
| `components/canvas/WorkflowCanvas.tsx` | React Flow canvas with nodeTypes registration |
| `components/sidebar-left/LeftSidebar.tsx` | Registry-driven node palette |

### Environment

| Variable | Service |
|----------|---------|
| `CLERK_*` | Authentication |
| `DATABASE_URL` | Neon PostgreSQL |
| `GEMINI_API_KEY` | Google Gemini (to be replaced with OpenRouter) |
| `TRIGGER_SECRET_KEY` | Trigger.dev cloud |

---

## 2. Architectural Rules

These are non-negotiable invariants. Every code change must respect them.

### Rule 1: Config-Driven Node System is the Single Source of Truth

Every node in the system is defined by a single `NodeConfig` object in `lib/nodes/configs/`. From this one object, the system auto-generates:
- The React Flow component (via `GenericNode.tsx`)
- The sidebar palette entry (via `registry.getPaletteEntries()`)
- Zod input/output validation schemas (via `registry.getInputSchema()`)
- Orchestrator dispatch logic (via `registry.resolveEndpoint()`)
- Credit cost estimation (via `config.credits.estimate()`)

**NEVER** create a standalone React component for a node. Always create a config file.

### Rule 2: No Hardcoded if/else Branching for Node Execution

The orchestrator must be **node-type-agnostic**. It calls `registry.resolveEndpoint(node.type, inputs)` to get the task ID and mapped payload. The current `orchestrator.ts` still has legacy if/else chains (lines 109-147) that must be migrated.

**BAD:**
```typescript
if (node.type === "llm") { ... }
else if (node.type === "crop") { ... }
```

**GOOD:**
```typescript
const endpoint = nodeRegistry.resolveEndpoint(node.type, inputs);
if (endpoint) {
  batchItems.push({ id: endpoint.taskId, payload: endpoint.payload });
}
```

### Rule 3: Connector-Setting Parity

Every `InputDefinition` in a node config generates **BOTH**:
1. A visible React Flow `Handle` (always rendered, even when Advanced accordion is collapsed)
2. A UI control (text input, number spinner, select dropdown, etc.)

When the handle is connected upstream, the UI control is **disabled** and shows `● linked`.

### Rule 4: High-End UI — Emil Design Engineering + Minimalist UI

All frontend work must follow premium design principles:
- **Micro-animations**: Smooth accordion expand/collapse, handle hover glow rings
- **Consistent typography**: 11px for node labels, `Suisse Intl` font globally
- **Dark theme**: `#141414` node backgrounds, `#09090b` input fields, `#27272a` borders
- **shadcn/ui components** for all dialogs, selects, inputs outside the canvas

### Rule 5: Provider Fallback Chain

Each node config defines an ordered `providers[]` array. The orchestrator tries providers in order until one succeeds. This enables future multi-provider resilience (e.g., fal.ai → replicate fallback).

### Rule 6: Passthrough Nodes Resolve Immediately

Nodes marked `isPassthrough: true` (Text, Image Upload, Video Upload) do not dispatch to Trigger.dev. Their inputs are mapped directly to outputs via `passthroughMapping`. The orchestrator calls `registry.resolvePassthrough()` and stores the result immediately.

### Rule 7: Use Direct Fetch for Fast Synchronous Providers

Fast request/response providers (e.g. OpenRouter chat completions) should run as a single Trigger.dev task with direct `await fetch()` + Zod validation. Reserve the `wait.createToken()` / `wait.forToken()` webhook pattern for slow async providers like fal.ai where the upstream job duration materially exceeds normal HTTP request windows.

### Rule 8: Normalize Media Streams Before FFmpeg Concat

Internal FFmpeg concat nodes must not assume source clips share the same resolution, SAR, framerate, sample rate, channel layout, or even audio presence. Before concatenation, normalize each clip in a `-filter_complex` graph (scale/pad, `setsar=1`, target FPS, audio resample/layout) and synthesize silence for clips with no audio so one mismatched input does not crash the merge.

---

## 3. Progress Log

### ✅ Phase 1 — COMPLETE (Apr 8, 2026)

**tRPC Migration + Foundation**

| Item | Status | Commit |
|------|--------|--------|
| Migrate all 10 API procedures from REST to tRPC | ✅ Done | `8c94564` |
| Frontend: replace all `fetch()` with tRPC hooks | ✅ Done | `8c94564` |
| Integrate superjson for Date/BigInt serialization | ✅ Done | `8c94564` |
| Initialize shadcn/ui (badge, card, dialog, dropdown, input, scroll-area, select, separator, sheet, sonner, tooltip) | ✅ Done | `8c94564` |
| Fix Trigger.dev project ID (`proj_yasmuuvbywhymfswqkam`) | ✅ Done | `8c94564` |
| Create `src/trigger/index.ts` for task discovery | ✅ Done | `8c94564` |
| Suisse Intl global font | ✅ Done | `8c94564` |
| Build passes clean | ✅ Verified | `8c94564` |

### ✅ Phase 2 — CORE ENGINE + WIRING COMPLETE (Apr 8, 2026)

**Config-Driven Node System**

| Item | Status | Commit |
|------|--------|--------|
| `lib/nodes/types.ts` — Full NodeConfig interface system | ✅ Done | `dbab896` |
| `lib/nodes/registry.ts` — NodeRegistry singleton (Zod gen, endpoint resolution, palette, connection validation, credits) | ✅ Done | `dbab896` |
| `lib/nodes/configs/crop.ts` — First config-driven node | ✅ Done | `dbab896` |
| `lib/nodes/configs/index.ts` — Auto-discovery + registration | ✅ Done | `dbab896` |
| `components/nodes/GenericNode.tsx` — Universal renderer with animated Advanced accordion | ✅ Done | `dbab896` |
| `WorkflowCanvas.tsx` — GenericNode wired into nodeTypes, registry-based connection validation with legacy fallback | ✅ Done | `dbab896` |
| `LeftSidebar.tsx` — Hardcoded NODE_TYPES replaced with `registry.getPaletteEntries()`, category grouping | ✅ Done | `dbab896` |
| Build passes clean, UI verified in browser | ✅ Verified | `dbab896` |

### ✅ Phase 2b — ORCHESTRATOR MIGRATION COMPLETE (Apr 9, 2026)

**Port Remaining Nodes + Orchestrator Migration**

| Item | Status |
|------|--------|
| Port `TextNode` to config (`lib/nodes/configs/text.ts`) | ✅ Done |
| Port `ImageNode` to config (`lib/nodes/configs/image.ts`) | ✅ Done |
| Port `VideoNode` to config (`lib/nodes/configs/video.ts`) | ✅ Done |
| Port `LLMNode` to config (`lib/nodes/configs/llm.ts`) | ✅ Done |
| Port `ExtractNode` to config (`lib/nodes/configs/extract.ts`) | ✅ Done |
| Migrate `orchestrator.ts` to use `registry.resolveEndpoint()` | ✅ Done |
| Delete legacy node components after migration | ✅ Done |

### ✅ Phase 3a — Seedream 4.5 Execution Pipeline COMPLETE (Apr 10, 2026)

**Full fal.ai async execution loop with credits, webhooks, and realtime UI**

| Item | Status |
|------|--------|
| `lib/nodes/configs/seedream.config.ts` — NodeConfig for Seedream 4.5 (text-to-image + image-edit) | ✅ Done |
| `lib/nodes/configs/__tests__/seedream.test.ts` — 31 Vitest tests (credits, Zod schema, endpoint selection) | ✅ Done |
| `vitest.config.ts` — Vitest setup with path aliases | ✅ Done |
| `prisma/schema.prisma` — Added `User.credits`, `CreditLedger` model, `Run.completedAt`, `NodeRun.providerUsed`, `NodeRun.creditsUsed` | ✅ Done |
| `lib/webhook-signing.ts` — HMAC-SHA256 `signToken`, `verifyWebhookSignature`, `buildWebhookUrl` | ✅ Done |
| `lib/__tests__/webhook-signing.test.ts` — 16 tests for signing/verification/URL building | ✅ Done |
| `app/api/webhooks/fal/[token]/route.ts` — Webhook receiver: HMAC verify → `wait.completeToken()` → always 200 | ✅ Done |
| `src/trigger/seedream.ts` — Trigger.dev task: Zod validate → endpoint select → POST fal.ai (10s timeout) → `wait.forToken()` (5m) → validate nested output | ✅ Done |
| `src/trigger/index.ts` — Added `seedream` export | ✅ Done |
| `src/trigger/orchestrator.ts` — Added `userId` to payload, post-completion credit deduction via `SELECT ... FOR UPDATE`, `providerUsed`/`creditsUsed` on NodeRun, `completedAt` on terminal Run | ✅ Done |
| `server/trpc/routers/workflow.ts` — Credit pre-check (`SELECT ... FOR UPDATE`), `userId` passthrough, scoped Realtime token via `auth.createPublicToken()`, returns `estimatedCredits` + `publicAccessToken` | ✅ Done |
| `lib/store.ts` — Added `nodeRunStatuses: Record<string, NodeRunStatus>`, `setNodeRunStatuses`, `clearNodeRunStatuses`, exported `NodeRunStatus` type | ✅ Done |
| `components/canvas/ExecutionControls.tsx` — Per-node status tracking, generic `result_${key}` output mapping, 4s status persist after completion | ✅ Done |
| `components/nodes/GenericNode.tsx` — Status indicators (pending/running/success/failed icons), status-colored borders, per-node Play ▶ button, `MultiInputOrderList` for reorderable multi-handles, audio `<audio>` preview in `OutputPreview`, direct client-to-Transloadit upload via `/api/upload/sign` (bypasses Next.js body limit) | ✅ Done |
| `app/api/upload/route.ts` — Rewritten to raw REST API (no SDK), `maxDuration=120`, FormData parse guard (413), video uploads skip encoding (upload-only for source nodes) | ✅ Done |
| `app/api/upload/sign/route.ts` — HMAC-SHA384 signature endpoint for client-side direct Transloadit uploads | ✅ Done |
| `prisma.config.ts` — Fixed to load `.env.local` first, then `.env`; uses `DIRECT_URL` for CLI operations | ✅ Done |
| 47/47 Vitest tests passing, TypeScript strict mode clean | ✅ Verified |

### 🔲 Phase 3b — Remaining New Nodes

| Node | Provider | Status |
|------|----------|--------|
| OpenRouter LLM | OpenRouter | ✅ Done — multimodal vision parity with Gemini node |
| Seedance 1.5 (Video Gen) | fal.ai | 🔲 Not started |
| ElevenLabs V3 (Audio Gen) | fal.ai | 🔲 Not started |
| Sync Lipsync (Video+Audio) | fal.ai | 🔲 Not started |
| Kling O1 (Video Edit) | fal.ai | 🔲 Not started |
| Extract Audio from Video | FFmpeg | ✅ Done |
| Merge Audio with Video | FFmpeg | 🔲 Not started |
| Merge Multiple Videos | FFmpeg | ✅ Done |

### 🔲 Phase 4 — Credits UI, Auto-Save, Polish

| Item | Status |
|------|--------|
| Credits UI (balance display, history panel) | 🔲 Not started |
| Auto-save (debounced Zustand → tRPC mutation) | 🔲 Not started |
| Public API + Unkey + MCP | 🔲 Not started |
| Playwright E2E tests | 🔲 Not started |
| Documentation (Mintlify) | 🔲 Not started |

---

## 4. Bug Fixes Log

| Date | Bug | Fix | File(s) |
|------|-----|-----|---------|
| Apr 8 | Trigger.dev CLI couldn't find tasks | Created `src/trigger/index.ts` barrel export | `src/trigger/index.ts` |
| Apr 8 | Trigger.dev project ID mismatch | Updated `trigger.config.ts` to `proj_yasmuuvbywhymfswqkam` | `trigger.config.ts` |
| Apr 8 | Zod v4 `ZodRawShape` is readonly | Replaced with `MutableShape = Record<string, ZodTypeAny>` | `lib/nodes/registry.ts` |
| Apr 8 | Font not rendering (Suisse Intl) | Added forced `font-family` on `html, body` + local font fallback chain | `app/globals.css` |
| Apr 9 | `TypeError: Failed to parse URL from undefined` in media.ts | Added strict URL validation guards before `fetch()` in both `cropImageTask` and `extractFrameTask` | `src/trigger/media.ts` |
| Apr 9 | LLM task crash on undefined `userMessage` | Added payload validation + graceful error for missing/empty userMessage; defensive image URL handling | `src/trigger/llm.ts` |
| Apr 9 | Ghost buttons — Cancel/Running UI disappearing mid-execution | Fixed stale closure in `pollRunStatus`; cancel no longer clears `isRunning` before API completes; added `TERMINAL_STATUSES` set for definitive state transitions | `components/canvas/ExecutionControls.tsx` |
| Apr 9 | Gemini 503 Service Unavailable crashing LLM task | Added exponential backoff retry (5 attempts, factor 2, 2s–30s); images array sanitized before processing | `src/trigger/llm.ts` |
| Apr 9 | PrismaClientValidationError: undefined in arrays | Added recursive `sanitizeForPrisma()` that strips undefined from all inputs/outputs before DB write | `src/trigger/orchestrator.ts` |
| Apr 9 | Single node failure kills entire orchestrator | Removed `throw` from batch error path; failed nodes are marked individually, orchestrator continues to PARTIAL | `src/trigger/orchestrator.ts` |
| Apr 9 | Legacy nodes writing to React Flow shadow state | Switched all nodeTypes to GenericNode; deleted legacy LLMNode/TextNode/ImageNode/ExtractNode/VideoNode | `WorkflowCanvas.tsx` |
| Apr 10 | Zod v4 `z.record()` requires two arguments | Changed `z.record(z.number())` to `z.record(z.string(), z.number())` for `timings` field in fal.ai webhook schema | `src/trigger/seedream.ts` |
| Apr 10 | `nodeRegistry.register()` called inside `beforeAll()` but schema accessed at describe-block level | Moved `nodeRegistry.register(seedreamConfig)` to module top-level so registration happens before all describe blocks execute | `lib/nodes/configs/__tests__/seedream.test.ts` |
| Apr 10 | fal.ai webhook payload shape was flat — actual shape nests under `payload.images[0].url` | Corrected `falWebhookSuccessSchema` to parse nested `payload.images[0].url`; updated task to use `successResult.data.payload.images[0].url` | `src/trigger/seedream.ts` |
| Apr 10 | Trigger.dev SDK method name drift — plan used `runs.completeWaitpoint` | Verified SDK types in `node_modules`; correct methods are `wait.createToken`, `wait.forToken`, `wait.completeToken` | `app/api/webhooks/fal/[token]/route.ts`, `src/trigger/seedream.ts` |
| Apr 10 | `directUrl` in `schema.prisma` rejected by Prisma 7 | Prisma 7 no longer supports `directUrl` in schema files — removed it from schema; direct URL now set only in `prisma.config.ts` via `datasource.url` | `prisma/schema.prisma`, `prisma.config.ts` |
| Apr 10 | `prisma db push` failing with P1001 — config not loading `.env.local` | `prisma.config.ts` was using `import "dotenv/config"` which only reads `.env`; replaced with explicit `config({ path: ".env.local" })` before `config({ path: ".env" })` | `prisma.config.ts` |
| Apr 10 | `channel_binding=require` in `DIRECT_URL` causes Prisma CLI TCP connection failure | Removed `channel_binding=require` from `DIRECT_URL`; kept it only in `DATABASE_URL` (used by Neon serverless driver at runtime which supports it) | `.env.local` |
| Apr 10 | `ExecutionControls` output mapping hardcoded for `llm`/`crop`/`extract` node types | Replaced hardcoded type checks with generic loop writing `result_${key}` for every output key; `GenericNode` OutputPreview already looks for `result_${previewOutputKey}` | `components/canvas/ExecutionControls.tsx` |
| Apr 10 | Stale Prisma client after schema changes — `User.credits` and `creditLedger` not recognized | Deleted `.prisma` cache with `rm -rf node_modules/.prisma` then re-ran `prisma generate` | `node_modules/.prisma` |
| Apr 10 | `credits: { decrement: { amount } }` — Prisma atomic op passed object instead of number | Changed to `{ decrement: amount }` (plain number as Prisma requires) | `src/trigger/orchestrator.ts` |
| Apr 10 | Prisma client stale — `credits` field and `CreditLedger` model missing from generated types | Ran `pnpm prisma generate` to regenerate client after schema additions | `prisma/schema.prisma` |
| Apr 10 | Seedream node renders as blank white rectangle with top/bottom handles | `"seedream-4.5"` was missing from `nodeTypes` map — React Flow fell back to its default node renderer | `components/canvas/WorkflowCanvas.tsx` |
| Apr 10 | Extract Audio node rendered as blank white rectangle with top/bottom handles | `"extract-audio"` config was registered, but the node type was not added to the `nodeTypes` map, so React Flow fell back to its default node renderer | `components/canvas/WorkflowCanvas.tsx` |
| Apr 10 | Video upload failed with `Transloadit: VIDEO_ENCODE_VALIDATION` in `GenericNode.handleFileChange` | `app/api/upload/route.ts` was forcing all video uploads through Transloadit's `/video/encode` step. For source video nodes we only need a public upload URL, so video uploads now use `/upload/handle` only and return the original uploaded file URL. | `app/api/upload/route.ts` |
| Apr 10 | Extract Audio completed successfully but had no playable preview in the node UI | `OutputPreview` in `GenericNode.tsx` only rendered previews for `image`, `video`, and `text`. Added `audio` support with an inline `<audio controls>` player so `audio_url` outputs can be listened to directly in the node. | `components/nodes/GenericNode.tsx` |
| Apr 10 | Credit check returns "available: 0" even after SQL UPDATE | `user.upsert` ran AFTER the credit pre-check — row didn't exist at check time so UPDATE matched 0 rows; moved upsert before credit check | `server/trpc/routers/workflow.ts` |
| Apr 10 | fal.ai endpoint slugs wrong — 403 auth errors on queue POST | Updated `FAL_GENERATE_ENDPOINT` → `fal-ai/bytedance/seedream/v4.5/text-to-image`, `FAL_EDIT_ENDPOINT` → `fal-ai/bytedance/seedream/v4.5/edit` | `src/trigger/seedream.ts` |
| Apr 10 | `aspect_ratio` field silently ignored by fal.ai Seedream API | fal.ai uses `image_size: { width, height }` — added `ASPECT_RATIO_TO_IMAGE_SIZE` lookup map converting ratio strings to pixel dimensions | `src/trigger/seedream.ts` |
| Apr 10 | Edit endpoint received `image_url` (string) but fal.ai requires `image_urls` (array) | Changed to `image_urls: [input.image_url]` for edit mode only | `src/trigger/seedream.ts` |
| Apr 10 | `guidance_scale` and `num_inference_steps` sent but not accepted by Seedream API | Removed both from fal request body (still present in UI/Zod schema, not forwarded) | `src/trigger/seedream.ts` |
| Apr 10 | ngrok tunneling port 80 — fal.ai webhooks silently dropped | ngrok was started with `ngrok http 80`; Next.js runs on 3000. Fix: restart with `ngrok http 3000` | Infrastructure (not code) |
| Apr 10 | Merge Audio & Video node missing from the left sidebar and would have rendered as a blank fallback node if added manually | Registered `mergeAudioVideoConfig` in the config index, added `"merge-audio-video"` to the React Flow `nodeTypes` map, and exported the Trigger task from `src/trigger/index.ts` | `lib/nodes/configs/index.ts`, `components/canvas/WorkflowCanvas.tsx`, `src/trigger/index.ts` |
| Apr 10 | New `logic` category nodes would be ungrouped or absent from the sidebar category order | Added `"logic"` to `NodeCategory`, plus sidebar labels and ordering, before registering `openrouter-llm` | `lib/nodes/types.ts`, `components/sidebar-left/LeftSidebar.tsx` |
| Apr 10 | OpenRouter LLM node would not appear/render correctly if only the config and task were created | Registered `openrouterConfig`, exported `openrouter-generate`, and added `"openrouter-llm"` to the React Flow `nodeTypes` map | `lib/nodes/configs/index.ts`, `src/trigger/index.ts`, `components/canvas/WorkflowCanvas.tsx` |
| Apr 10 | OpenRouter LLM shipped without multimodal vision parity, so image handles connected to the node were ignored | Added `images` as a multi-image config input, mapped it through the provider payload, sanitized empty entries in the Trigger task, and sent images as OpenRouter `image_url` content parts alongside the user text | `lib/nodes/configs/openrouter.config.ts`, `src/trigger/openrouter.task.ts` |
| Apr 10 | FFmpeg concat can fail on mixed resolutions, SAR, framerates, sample rates, channel layouts, or clips without audio | Added `merge-videos` with a concat `-filter_complex` that normalizes video/audio streams to the first clip's format and injects silent audio for clips without an audio stream | `lib/nodes/configs/merge-videos.config.ts`, `src/trigger/ffmpeg-merge-videos.task.ts` |
| Apr 10 | Merge Videos node would not appear in the palette or would render as a blank fallback node if only the config/task were created | Registered `mergeVideosConfig`, exported `ffmpeg-merge-videos`, and added `"merge-videos"` to the React Flow `nodeTypes` map | `lib/nodes/configs/index.ts`, `src/trigger/index.ts`, `components/canvas/WorkflowCanvas.tsx` |
| Apr 10 | Upload route crashed on large video files (default 4MB Next.js body limit) | Added `export const maxDuration = 120` for Vercel route config; wrapped `request.formData()` in try/catch returning 413 on parse failure; updated user-facing error to suggest smaller file or URL paste | `app/api/upload/route.ts` |
| Apr 10 | `GenericNode` upload hitting Next.js body limit on large files | Switched to **direct client-to-Transloadit upload** pattern: frontend calls `/api/upload/sign` for HMAC params, then POSTs directly to `api2.transloadit.com/assemblies`, polls assembly client-side. Server body limit no longer applies. | `components/nodes/GenericNode.tsx` |
| Apr 10 | Multi-input handles (e.g., Merge Videos `video_urls`) had no way to reorder connected sources | Added `MultiInputOrderList` component inside `GenericNode.tsx` — shows reorderable list with video thumbnails, accent-coded position badges, and up/down arrows. Order persisted in `node.data._inputOrder[handleKey]` | `components/nodes/GenericNode.tsx` |
| Apr 10 | Per-node execution status not visible at a glance | Added status indicator icons (Pending=Clock, Running=Spinner, Success=CheckCircle, Failed=XCircle) next to node name in header; border color changes based on status (emerald/red/amber) | `components/nodes/GenericNode.tsx`, `lib/store.ts` |
| Apr 10 | No way to run a single node from within the node itself | Added per-node Play ▶ button in header (hidden for passthrough nodes); dispatches `nextflow:run-nodes` custom event picked up by `ExecutionControls` | `components/nodes/GenericNode.tsx` |
| Apr 11 | Dirty 2s `setInterval` polling loop hammering database for run status | Ripped out `pollingRef`/`setInterval`/`clearInterval` from `ExecutionControls`; added `metadata.set()` calls in orchestrator for per-node status/outputs; wired `useRealtimeRun` from `@trigger.dev/react-hooks` with `enabled` gate; added `triggerToken` tRPC query for token refresh; Zustand store receives identical status updates via realtime `useEffect` sync | `components/canvas/ExecutionControls.tsx`, `src/trigger/orchestrator.ts`, `server/trpc/routers/workflow.ts` |
| Apr 11 | Output preview not showing after realtime migration (crop node, seedream, etc.) | **Race condition**: Electric SQL can deliver the Trigger.dev `COMPLETED` status event *before* the last `metadata.set("nodeOutputs", …)` flush arrives. The terminal handler was immediately nulling `triggerId`/`accessToken`, killing the SSE subscription before the output metadata event was processed. **Fix**: added one-shot DB fetch (`workflow.status` query) in the terminal handler as an authoritative safety net — reads `nodeRun.outputs` from Prisma and calls `syncNodeOutputsToStore()`. Credential cleanup (`setTriggerId(null)`, `setAccessToken(null)`) is deferred to `.finally()` of this fetch so the SSE subscription stays alive during the query. Extracted output-syncing logic into reusable `syncNodeOutputsToStore()` callback used by both the realtime `useEffect` and the DB fallback. | `components/canvas/ExecutionControls.tsx` |
| Apr 11 | FFmpeg crop filter crashes with `NaN` expression when `x`/`y`/`w`/`h` are `undefined` | Crop task received `undefined` payload fields from unset node inputs → `undefined / 100 * width = NaN` → `crop=NaN:NaN:NaN:NaN`. Fixed with `Number()` coercion + fallback defaults (`0` for x/y, `100` for w/h) + clamping to valid pixel ranges (`x/y ≥ 0`, `w/h ≥ 1`, no overflow past image bounds) | `src/trigger/media.ts` |
| Apr 11 | Realtime subscription silently fails → no node animations or output previews | `auth.createPublicToken()` throws (env var / API issue) but catch block swallowed the error, returning `undefined` token. **Fix**: (1) Error logging in `workflow.ts` catch block. (2) Token retry via `triggerToken` tRPC query when initial mint fails. (3) Toast shown to user if both attempts fail. | `components/canvas/ExecutionControls.tsx`, `server/trpc/routers/workflow.ts` |
| Apr 12 | Fallback DB polling loop re-introduced complexity and fought with realtime hook | Removed `realtimeActiveRef`, `fallbackPollRef`, `DB_TERMINAL_STATUSES`, and entire fallback poll `useEffect`. Replaced terminal state detection with `useRealtimeRun`'s built-in `onComplete` callback (per official Trigger.dev docs). `onComplete` fires exactly once when the run reaches terminal state, syncs final metadata, then does a one-shot DB fetch as a safety net for the Electric SQL metadata race. Cancel handler directly clears `currentRunIdRef` to prevent double-cleanup if `onComplete` fires concurrently. | `components/canvas/ExecutionControls.tsx` |

---

## 5. Known Issues & Tech Debt

| Issue | Severity | Notes |
|-------|----------|-------|
| `server/trpc/root.ts` has stub imports for `credits` and `apiKeys` routers | ⚠️ Low | Expected — Phase 4 placeholder |
| CSS lints on `@theme`, `@apply`, `@custom-variant` | ℹ️ Info | Tailwind v4 CSS-first config; IDE doesn't recognize new at-rules |
| `orchestrator.ts` still uses legacy if/else branching | ✅ Fixed | Migrated to `registry.resolveEndpoint()` in Phase 2b |
| Legacy node components still exist alongside GenericNode | ✅ Fixed | All nodes ported to GenericNode; legacy files deleted (TextNode, ImageNode, VideoNode, LLMNode, ExtractNode) |
| Single failing node crashes entire workflow | ✅ Fixed | Orchestrator now marks individual nodes FAILED, continues to PARTIAL |
| Upload route uses Transloadit SDK (flaky in serverless) | ✅ Fixed | Rewritten to raw REST API matching `media.ts` pattern; client-side direct upload option added |
| Multi-input handles have no ordering UI | ✅ Fixed | `MultiInputOrderList` component with drag reordering, persisted in `_inputOrder` |
| No tests | ✅ Partially fixed | 47 Vitest tests added (seedream config + webhook signing); Playwright still needed |
| Neon database `P1001` errors with Prisma CLI | ✅ Fixed | Use `DIRECT_URL` (no `-pooler`, no `channel_binding`) in `prisma.config.ts`; DB must be awake in Neon console |
| Credits UI not built | 🔴 High | `User.credits` column exists, ledger exists, but no balance display or top-up UI yet |
| `@trigger.dev/react-hooks` wired | ✅ Fixed | `useRealtimeRun` replaces 2s polling loop; orchestrator streams per-node status/outputs via `metadata.set()` |

---

## 6. API Keys Required

| Service | Env Variable | Status |
|---------|-------------|--------|
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | ✅ Configured |
| Neon PostgreSQL (pooled, runtime) | `DATABASE_URL` | ✅ Configured |
| Neon PostgreSQL (direct, CLI only) | `DIRECT_URL` | ✅ Configured — no `channel_binding`, no `-pooler` in host |
| Google Gemini | `GEMINI_API_KEY` | ✅ Configured |
| Trigger.dev | `TRIGGER_SECRET_KEY` | ✅ Configured |
| OpenRouter | `OPENROUTER_API_KEY` | ❌ Not yet added |
| fal.ai | `FAL_KEY` | ✅ Configured |
| fal.ai Webhook HMAC | `FAL_WEBHOOK_SECRET` | ✅ Generated (Apr 10) — do NOT rotate while a run is in progress |
| Public webhook URL | `NEXT_PUBLIC_APP_URL` | ⚠️ Must be set — use `ngrok http 3000` locally (port 3000, not 80) |
| Transloadit | `NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY`, `TRANSLOADIT_AUTH_SECRET` | ✅ Configured (file uploads) |

## 7. Webhook & Async Execution Architecture

### fal.ai Webhook Pattern (implemented Apr 10)

```
tRPC execute
  └── orchestrator task (Trigger.dev)
        └── seedream task (Trigger.dev)
              ├── POST fal.ai/queue + webhook_url (HMAC-signed)
              ├── wait.forToken(tokenId, "5m")     ← pauses here
              │
              │   ... fal.ai generates image ...
              │
              └── fal.ai POSTs to /api/webhooks/fal/[token]?sig=...
                    ├── verifyWebhookSignature(token, sig)  ← before any try/catch
                    ├── wait.completeToken(token, body)     ← error swallowed
                    └── return 200 always                   ← prevents fal.ai retries
```

### Credit Flow (implemented Apr 10)

```
tRPC execute
  ├── SELECT credits FROM "User" FOR UPDATE     ← soft gate, estimate only
  ├── throw FORBIDDEN if balance < estimate
  └── trigger orchestrator (fire and forget)

Orchestrator (after each successful async node)
  └── deductCredits():
        ├── SELECT credits FROM "User" FOR UPDATE  ← hard row lock
        ├── User.credits -= nodeRegistry.calculateCredits(actual response)
        └── CreditLedger.create({ delta: -actual, reason, workflowRunId, nodeRunId })
        (DB failure here is non-fatal — logged, orchestrator continues)
```

### Realtime Status Streaming (rewritten Apr 12 — no polling)

```
tRPC execute → triggers orchestrator → returns { triggerId, publicAccessToken }
  │                                          (token retry via triggerToken query if initial mint fails)
  │
  └── useRealtimeRun(triggerId, { accessToken, enabled, onComplete })
        │
        │   ... orchestrator runs layers ...
        │   metadata.set("nodeStatuses", { nodeId: "RUNNING" | "SUCCESS" | "FAILED" })
        │   metadata.set("nodeOutputs", { nodeId: { url: "...", text: "..." } })
        │   metadata.set("runStatus", "SUCCESS" | "PARTIAL" | "FAILED")
        │
        ├── useEffect (live): syncs run.metadata → Zustand store on every SSE update
        │     ├── setNodeRunStatuses(nodeStatuses)
        │     ├── setRunningNodeIds(running nodes)
        │     └── syncNodeOutputsToStore(nodeOutputs → result_* on node.data)
        │
        └── onComplete (terminal): fires once when run reaches terminal status
              ├── Sync final metadata from completed run object
              ├── setIsRunning(false), setRunningNodeIds([])
              ├── One-shot DB fetch (workflow.status) as safety net for
              │   Electric SQL race (COMPLETED before last metadata flush)
              └── Credential cleanup (triggerId, accessToken → null) in .finally()
```

### Key invariants
- HMAC check happens **before** try/catch in webhook route — invalid sig → 401
- `wait.completeToken` errors are **swallowed** — webhook always returns 200
- Credit deduction failures are **non-fatal** — never crash a completed generation
- `publicAccessToken` (15min TTL, read-only, scoped to single Trigger.dev run) returned by tRPC `execute` and refreshable via `triggerToken` query
- `metadata.set()` in orchestrator is synchronous fire-and-forget — does not block execution
- `useRealtimeRun` disabled when `triggerId`/`accessToken` are null — zero wasted SSE connections
- **No polling of any kind** — all updates come via Electric SQL SSE; one-shot DB fetch only on terminal state as race-condition safety net
- Cancel handler clears `currentRunIdRef` immediately to prevent double-cleanup if `onComplete` fires concurrently

---

## 8. GenericNode Architecture (Updated Apr 10)

### Upload Flow (Client-Side Direct Upload)
```
User selects file in MediaSourceArea
  └── POST /api/upload/sign   { type: "image" | "video" }
        └── Returns: { params, signature }   (HMAC-SHA384)
              └── POST api2.transloadit.com/assemblies
                    body: params + signature + file
                    └── Returns: { assembly_ssl_url }
                          └── Poll assembly_ssl_url every 2s (max 120s)
                                └── ASSEMBLY_COMPLETED → extract ssl_url
                                      └── updateField("url", cdnUrl)
```

### Multi-Input Ordering
- `MultiInputOrderList` renders when a `multi: true` input has 2+ incoming edges
- Order stored in `node.data._inputOrder[handleKey]` as `string[]` of source node IDs
- Visually: numbered accent-colored badges + video thumbnails + up/down arrows
- Orchestrator reads `_inputOrder` to determine array element order for merge operations

### Per-Node Status Display
- `nodeRunStatuses: Record<string, NodeRunStatus>` in Zustand store
- `NodeRunStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED"`
- Header shows status icon (Clock/Spinner/CheckCircle/XCircle)
- Node border color changes: emerald (success), red (failed), amber (running)
- Per-node Play ▶ button dispatches `nextflow:run-nodes` custom event to `ExecutionControls`

---

*Last updated: Apr 11, 2026*
̆̆