# Step 3 Checkpoint — Webhook Route + HMAC Signing

## What Was Built

### HMAC Signing Utility (`lib/webhook-signing.ts`)
- `signToken(tokenId)` — HMAC-SHA256 of token ID using `FAL_WEBHOOK_SECRET`
- `verifyWebhookSignature(tokenId, sig)` — timing-safe comparison to prevent timing attacks
- `buildWebhookUrl(tokenId)` — constructs full URL: `{APP_URL}/api/webhooks/fal/{token}?sig={hmac}`
- Throws descriptive errors when env vars are missing

### Webhook Route (`app/api/webhooks/fal/[token]/route.ts`)
- **POST handler** receives fal.ai callback payloads
- **Execution order** (critical for security):
  1. HMAC signature verification → 401 on failure (BEFORE try/catch)
  2. JSON body parsing → 400 on malformed
  3. `wait.completeToken(token, body)` → errors swallowed, logged
  4. Always returns 200 `{ received: true }` (prevents fal.ai retry storms)
- **No blocking operations** — no Prisma writes, no heavy computation
- Token IDs URL-encoded/decoded for safe transport

### Security Properties
- External actors cannot construct valid webhook URLs without `FAL_WEBHOOK_SECRET`
- Timing-safe HMAC comparison prevents timing side-channel attacks
- Post-timeout webhooks handled gracefully (completeToken fails silently, 200 returned)
- `FAL_WEBHOOK_SECRET` is server-only (no `NEXT_PUBLIC_` prefix)

## Files Created / Modified

| File | Action | Description |
|------|--------|-------------|
| `lib/webhook-signing.ts` | **CREATED** | HMAC sign/verify/buildUrl utilities |
| `app/api/webhooks/fal/[token]/route.ts` | **CREATED** | Webhook POST handler |
| `lib/__tests__/webhook-signing.test.ts` | **CREATED** | 16 tests for signing utilities |

## Test Results

```
 ✓ lib/__tests__/webhook-signing.test.ts (16 tests)
   ✓ signToken (4 tests)
   ✓ verifyWebhookSignature (7 tests)
   ✓ buildWebhookUrl (4 tests)
   ✓ roundtrip verification (1 test)

 Tests:   16 passed
 TypeScript: zero errors
 Lints:     zero errors
```

## Git Recommendation

```bash
git add -A && git commit -m "feat(webhooks): add fal.ai webhook route with HMAC signing

- HMAC-SHA256 signing/verification for webhook token URLs
- Timing-safe comparison prevents side-channel attacks
- POST /api/webhooks/fal/[token] delivers payload to Trigger.dev waitpoint
- HMAC check before error-swallowing try/catch (401 vs 200 distinction)
- Always returns 200 after valid HMAC to prevent fal.ai retry storms
- 16 tests covering sign, verify, URL building, and roundtrip"
```

## Next Step

**Step 4: Seedream Trigger.dev Task** — Create `src/trigger/seedream.ts` with 
fal.ai REST call, `wait.createToken()` + `wait.forToken()`, Zod output validation 
for nested `payload.images[0].url`, and NodeRun status writes.
