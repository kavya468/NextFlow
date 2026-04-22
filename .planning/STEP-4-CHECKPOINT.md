# Step 4 Checkpoint — Seedream Trigger.dev Task

## What Was Built

Trigger.dev task for fal.ai's Seedream 4.5 model using the webhook/waitpoint 
pattern. This is the first fal.ai integration in the codebase.

### Execution Flow
1. **Zod input validation** — rejects missing prompt, malformed image_url, 
   out-of-range guidance_scale/inference_steps
2. **Endpoint selection** — `image_url` present → `fal-ai/seedream-4.5/edit`, 
   absent → `fal-ai/seedream-4.5`
3. **Waitpoint token** — `wait.createToken({ timeout: "5m" })` creates a 
   pausable waitpoint
4. **HMAC-signed webhook URL** — `buildWebhookUrl(token.id)` from Step 3
5. **fal.ai REST POST** — queue the job with `webhook_url`, 10s timeout on 
   initial connection via `AbortSignal.timeout()`
6. **`wait.forToken()`** — task pauses until fal.ai POSTs to webhook route 
   (max 5 minutes)
7. **Output validation** — Zod schema validates nested `payload.images[0].url` 
   (corrected from flat schema per review feedback)
8. **Error/success response handling** — checks for `status: "ERROR"` before 
   parsing success schema
9. **Return** — `{ image_url: string }`

### Error Handling (All Explicit)
| Error Case | Detection | Behavior |
|------------|-----------|----------|
| fal.ai non-200 | `!response.ok` | Throw with status + body excerpt |
| fal.ai connection timeout | `AbortSignal.timeout(10s)` | Throw "fal.ai connection timeout" |
| fal.ai network error | fetch catch | Throw "fal.ai network error: ..." |
| fal.ai response not JSON | `.json()` catch | Throw "not valid JSON" |
| Wait timeout (5min) | `waitResult.ok === false` | Throw "Provider timeout" |
| fal.ai returns ERROR status | Zod parse of error schema | Throw "fal.ai generation failed: ..." |
| Output schema mismatch | Zod parse fail | Throw "Invalid provider response" + issues |
| Missing FAL_KEY env var | Explicit check | Throw with setup instructions |

### SDK Methods Used (Verified Against Installed Types)
- `wait.createToken({ timeout, tags })` → `{ id, url, isCached }`
- `wait.forToken<T>(token)` → `{ ok: true, output: T } | { ok: false, error }`
- `wait.completeToken(token, data)` (in webhook route from Step 3)

## Files Created / Modified

| File | Action | Description |
|------|--------|-------------|
| `src/trigger/seedream.ts` | **CREATED** | Full Seedream 4.5 task with webhook pattern |
| `src/trigger/index.ts` | **MODIFIED** | Added `export * from "./seedream"` |

## Verification

```
 Tests:     47 passed (31 config + 16 webhook — no regression)
 TypeScript: zero errors (tsc --noEmit)
 Lints:     zero errors
```

## Git Recommendation

```bash
git add -A && git commit -m "feat(trigger): add Seedream 4.5 task with fal.ai webhook/waitpoint pattern

- POST to fal.ai queue endpoint with HMAC-signed webhook URL
- wait.forToken() pauses task until fal.ai callback arrives
- Zod validation on nested webhook payload (payload.images[0].url)
- Dual endpoint selection: generate vs edit based on image_url
- Explicit error handling for all boundary crossings (timeout, non-200, schema)"
```

## Next Step

**Step 5: Orchestrator Credit Deduction** — Modify `src/trigger/orchestrator.ts` 
to add post-completion credit deduction via Postgres `SELECT ... FOR UPDATE` 
transaction. Block-on-estimate, deduct-on-completion pattern.
