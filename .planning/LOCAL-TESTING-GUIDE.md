# NextFlow — Environment Variables & Local Testing Guide

## Table of Contents

1. [Complete Environment Variables](#1-complete-environment-variables)
2. [New Variables Added by the Execution Pipeline](#2-new-variables-added-by-the-execution-pipeline)
3. [Local Setup Checklist](#3-local-setup-checklist)
4. [Database Migration](#4-database-migration)
5. [Running Locally](#5-running-locally)
6. [Testing the Seedream 4.5 Node End-to-End](#6-testing-the-seedream-45-node-end-to-end)
7. [What to Expect](#7-what-to-expect)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Complete Environment Variables

Every variable the app needs, grouped by service:

```env
# ═══════════════════════════════════════════════════════════════════════
# 1. CLERK AUTHENTICATION
#    Sign up: https://clerk.com → Create application → Copy keys
# ═══════════════════════════════════════════════════════════════════════
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...    # Public — safe in browser
CLERK_SECRET_KEY=sk_test_...                     # Server only — NEVER expose

# ═══════════════════════════════════════════════════════════════════════
# 2. DATABASE (Neon PostgreSQL)
#    Sign up: https://neon.tech → Create database → Connection string
# ═══════════════════════════════════════════════════════════════════════
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# ═══════════════════════════════════════════════════════════════════════
# 3. GOOGLE GEMINI (LLM Provider)
#    Get key: https://aistudio.google.com/apikey
# ═══════════════════════════════════════════════════════════════════════
GEMINI_API_KEY=AIza...

# ═══════════════════════════════════════════════════════════════════════
# 4. TRIGGER.DEV (Job Execution Engine)
#    Sign up: https://trigger.dev → Create project → API keys page
# ═══════════════════════════════════════════════════════════════════════
TRIGGER_SECRET_KEY=tr_dev_...                    # Server only — used by SDK

# ═══════════════════════════════════════════════════════════════════════
# 5. TRANSLOADIT (Media Processing)
#    Sign up: https://transloadit.com → Credentials page
# ═══════════════════════════════════════════════════════════════════════
NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY=...              # Public — used by Uppy client
TRANSLOADIT_AUTH_SECRET=...                      # Server only — signs assemblies

# ═══════════════════════════════════════════════════════════════════════
# 6. FAL.AI (Seedream 4.5 Image Generation) ★ NEW
#    Sign up: https://fal.ai → Dashboard → API keys
# ═══════════════════════════════════════════════════════════════════════
FAL_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx:... # Server only — authenticates API calls

# ═══════════════════════════════════════════════════════════════════════
# 7. WEBHOOK SECURITY ★ NEW
#    Generate your own: openssl rand -hex 32
# ═══════════════════════════════════════════════════════════════════════
FAL_WEBHOOK_SECRET=<your-random-64-char-hex>     # Server only — HMAC signing

# ═══════════════════════════════════════════════════════════════════════
# 8. PUBLIC APP URL ★ NEW (Required for webhooks)
#    Local: ngrok URL | Production: your Vercel/domain URL
# ═══════════════════════════════════════════════════════════════════════
NEXT_PUBLIC_APP_URL=https://xxxx-xx-xx-xx-xx.ngrok-free.app
```

---

## 2. New Variables Added by the Execution Pipeline

| Variable | Where Used | Purpose |
|----------|-----------|---------|
| `FAL_KEY` | `src/trigger/seedream.ts` | Authenticates POST requests to fal.ai queue API |
| `FAL_WEBHOOK_SECRET` | `lib/webhook-signing.ts` | HMAC-SHA256 signs webhook URLs so only legitimate fal.ai callbacks are accepted |
| `NEXT_PUBLIC_APP_URL` | `lib/webhook-signing.ts` | Base URL for constructing the webhook callback URL that fal.ai POSTs to |

### How to generate `FAL_WEBHOOK_SECRET`

```bash
# Option 1: OpenSSL (recommended)
openssl rand -hex 32

# Option 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output and paste it as the value. This secret never leaves your server — it signs the webhook token so the webhook route can verify the callback is authentic.

### How to get `FAL_KEY`

1. Go to https://fal.ai/dashboard/keys
2. Create a new API key
3. Copy the full key (format: `uuid:hex`)

### How to set `NEXT_PUBLIC_APP_URL`

This **must** be a URL reachable from the public internet. fal.ai's servers need to POST to it when image generation completes.

- **Local development**: Use ngrok (see Section 3)
- **Production**: Your deployment URL (e.g., `https://nextflow.vercel.app`)

---

## 3. Local Setup Checklist

### Prerequisites

- Node.js 18+
- pnpm / npm / yarn
- A Trigger.dev account with CLI logged in
- ngrok installed (`brew install ngrok` or https://ngrok.com/download)

### Step-by-step

```bash
# 1. Install dependencies (if not already done)
pnpm install

# 2. Generate the webhook secret
openssl rand -hex 32
# → Copy output, paste into .env.local as FAL_WEBHOOK_SECRET

# 3. Start ngrok tunnel (separate terminal — keep running)
ngrok http 3000

# → Copy the https://xxxx.ngrok-free.app URL
# → Paste into .env.local as NEXT_PUBLIC_APP_URL
# IMPORTANT: No trailing slash!

# 4. Run the database migration
npx prisma db push

# 5. Start the Next.js dev server
pnpm dev

# 6. Start the Trigger.dev dev worker (separate terminal)
npx trigger dev
```

You need **3 terminals** running simultaneously:

| Terminal | Command | Purpose |
|----------|---------|---------|
| 1 | `ngrok http 3000` | Public tunnel for fal.ai webhooks |
| 2 | `pnpm dev` | Next.js dev server on localhost:3000 |
| 3 | `npx trigger dev` | Trigger.dev worker that runs orchestrator + tasks |

---

## 4. Database Migration

The Prisma schema now includes new fields and models. Run:

```bash
npx prisma db push
```

This will apply these changes to your Neon database:

| Change | What it does |
|--------|-------------|
| `User.credits` (new column) | `Int @default(0)` — microcredit balance |
| `User.ledger` (new relation) | Links user to their credit history |
| `Run.completedAt` (new column) | `DateTime?` — set on terminal status |
| `NodeRun.providerUsed` (new column) | `String?` — e.g. "fal", "gemini" |
| `NodeRun.creditsUsed` (new column) | `Int?` — actual credits consumed |
| `CreditLedger` (new table) | Audit trail for all credit transactions |

**Warning**: If you already have production data, review the migration SQL first:

```bash
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script
```

---

## 5. Running Locally

### Verify everything is connected

Once all 3 terminals are running, open http://localhost:3000 and:

1. **Sign in** via Clerk (you should see the auth flow)
2. **Create or open a workflow** — you should see the canvas
3. **Check the Trigger.dev dashboard** (https://cloud.trigger.dev) — your worker should show as connected with tasks:
   - `orchestrate-workflow`
   - `llm-generate`
   - `media-process`
   - `seedream-4.5` ← new

### Give yourself credits for testing

Since the credit pre-check blocks execution if balance is insufficient, you need to manually seed credits for your user:

```sql
-- Run this in your Neon SQL editor (https://console.neon.tech → SQL Editor)
-- Replace 'your_clerk_user_id' with your actual Clerk user ID
-- (Find it in Clerk dashboard → Users → click your user → User ID)

UPDATE "User" SET credits = 1000000 WHERE id = 'your_clerk_user_id';
```

1,000,000 credits = $1.00. The Seedream node estimates 15,000 credits per generation (~$0.015), so 1M credits gives you ~66 test runs.

Alternatively, you can temporarily comment out the credit check in `server/trpc/routers/workflow.ts` for testing (the `if (estimatedCredits > 0)` block).

---

## 6. Testing the Seedream 4.5 Node End-to-End

### Test 1: Text-to-Image Generation

1. **Drag a "Seedream 4.5" node** from the left sidebar (AI category, sparkle icon) onto the canvas
2. **Type a prompt**: e.g., `"A serene mountain landscape at golden hour, photorealistic"`
3. **Leave image_url empty** (this selects text-to-image mode)
4. **Click the ▶ Run button** (either the bottom toolbar or the play icon on the node header)
5. **Watch the node states**:
   - Border turns **amber** + spinning loader → RUNNING
   - Border turns **green** + checkmark → SUCCESS (image preview appears)
   - OR border turns **red** + X → FAILED (check console/Trigger.dev dashboard for errors)
6. The generated image URL should appear in the output preview area on the node

### Test 2: Image Editing

1. Add a **Text node** and an **Image node** upstream of a Seedream node
2. **Connect** the Image node's output → Seedream's `image_url` input
3. **Connect** the Text node's output → Seedream's `prompt` input
4. Enter a source image URL in the Image node and an edit prompt like `"Add a sunset sky"`
5. **Run** — this should hit the `/edit` endpoint instead of the generate endpoint

### Test 3: Insufficient Credits

1. Set your user's credits to 0 in the database:
   ```sql
   UPDATE "User" SET credits = 0 WHERE id = 'your_clerk_user_id';
   ```
2. Try running a workflow with a Seedream node
3. **Expected**: The mutation should fail with a `FORBIDDEN` error and message about insufficient credits

### Test 4: Run a Single Node

1. Place multiple nodes on the canvas
2. Click the **small ▶ play button** on a specific Seedream node's header
3. **Expected**: Only that node (and its upstream dependencies) execute — other branches are skipped

---

## 7. What to Expect

### Happy Path Timeline

```
t=0s    Click Run
        → tRPC mutation fires
        → Credit pre-check passes (SELECT ... FOR UPDATE)
        → Run + NodeRun rows created (status: RUNNING/PENDING)
        → Orchestrator triggered on Trigger.dev
        → Polling starts (2s intervals)

t=1-2s  Node border turns amber, spinner appears
        → Orchestrator processes DAG layers
        → Seedream task starts
        → POST to fal.ai queue API (webhook URL included)
        → Task pauses at wait.forToken()

t=10-60s fal.ai generates the image (varies by complexity)
        → fal.ai POSTs to your ngrok webhook URL
        → Webhook route verifies HMAC signature
        → wait.completeToken() resumes the task
        → Task validates output, returns { image_url }

t=~62s  Orchestrator receives result
        → Credits deducted (SELECT ... FOR UPDATE transaction)
        → NodeRun updated (SUCCESS, creditsUsed, providerUsed)
        → Run updated (SUCCESS, completedAt)

t=~64s  Polling picks up SUCCESS status
        → Node border turns green, checkmark appears
        → Image preview renders on the node
        → Status indicators persist 4 seconds, then fade
```

### What Shows in the UI

| State | Node Border | Icon | Button |
|-------|-------------|------|--------|
| Idle | Gray | Node type icon | ▶ Play visible |
| Pending | Gray | Clock icon | Hidden |
| Running | Amber glow | Spinning loader | Hidden (cancel at toolbar) |
| Success | Green glow (4s) | Green checkmark | ▶ Play returns after clear |
| Failed | Red glow (4s) | Red X | ▶ Play returns after clear |

### What Shows in the Console

- `Triggered Run: { runId, triggerId, workflowId, scope, nodeCount, estimatedCredits, publicAccessToken }`
- Trigger.dev worker logs: endpoint selection, webhook URL, queue response, credit deduction

### What Shows in the Database

After a successful run:

- **Run**: status=SUCCESS, completedAt set, durationMs calculated
- **NodeRun**: status=SUCCESS, outputs={image_url: "..."}, providerUsed="fal", creditsUsed=15000
- **CreditLedger**: delta=-15000, reason="seedream-4.5 execution", workflowRunId linked
- **User**: credits decremented by 15000

---

## 8. Troubleshooting

### "FAL_WEBHOOK_SECRET is not set"

You forgot to add the webhook secret to `.env.local`. Generate one:
```bash
openssl rand -hex 32
```

### "NEXT_PUBLIC_APP_URL is not set"

The webhook URL builder needs your public URL. Start ngrok and copy the HTTPS URL.

### Webhook never arrives (task times out after 5 minutes)

1. **Check ngrok is running** and forwarding to port 3000
2. **Check the ngrok URL matches** `.env.local` NEXT_PUBLIC_APP_URL (no trailing slash)
3. **Check the Next.js server is running** on port 3000
4. **Check ngrok's web inspector** at http://localhost:4040 — you should see POST requests from fal.ai
5. **Check the fal.ai dashboard** for the request status — it may show a delivery failure

**Common cause**: You restarted ngrok and got a new URL but didn't update `.env.local`. ngrok free tier generates a new URL each time.

**Fix**: Use `ngrok http 3000 --url=your-static-subdomain.ngrok-free.app` if you have a reserved domain, or restart Next.js after updating the URL.

### "HMAC verification failed" in logs

The `FAL_WEBHOOK_SECRET` in your `.env.local` changed between when the webhook URL was signed (task start) and when the callback arrived (seconds/minutes later). Don't change the secret while a run is in progress.

### "Insufficient credits" error on execute

Your user has 0 credits. Seed them:
```sql
UPDATE "User" SET credits = 1000000 WHERE id = 'your_clerk_user_id';
```

### Trigger.dev worker not picking up tasks

1. Make sure `npx trigger dev` is running
2. Check that it shows `seedream-4.5` in the registered tasks list
3. If not, the `src/trigger/seedream.ts` file might have an import error — check the worker terminal for errors

### Node stays in RUNNING forever (no timeout)

The Seedream task has a 5-minute waitpoint timeout. If fal.ai doesn't call back within 5 minutes, the task will fail with a timeout error and the node will turn red. If it's stuck beyond 5 minutes:

1. Check the Trigger.dev dashboard for the run status
2. Cancel the run from the UI
3. Check if ngrok is still running

### Image preview doesn't appear after success

The polling writes `result_image_url` into node data. The GenericNode's `OutputPreview` component looks for this key. Verify:
1. The NodeRun outputs in the database have `{ "image_url": "https://..." }`
2. The Seedream config has `ui.showOutputPreview: true` and `ui.previewOutputKey: "image_url"`

---

## Quick Reference: Your .env.local Template

```env
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Database
DATABASE_URL="postgresql://..."

# LLM
GEMINI_API_KEY=AIza...

# Trigger.dev
TRIGGER_SECRET_KEY=tr_dev_...

# Transloadit
NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY=...
TRANSLOADIT_AUTH_SECRET=...

# fal.ai (NEW)
FAL_KEY=...

# Webhook Security (NEW — generate with: openssl rand -hex 32)
FAL_WEBHOOK_SECRET=...

# Public URL (NEW — your ngrok URL for local, Vercel URL for prod)
NEXT_PUBLIC_APP_URL=https://xxxx.ngrok-free.app
```
