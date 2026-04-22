// ============================================================================
// app/api/webhooks/fal/[token]/route.ts — fal.ai Webhook Receiver
// ============================================================================
//
// fal.ai POSTs here when an async generation job completes.
// This route delivers the payload to the paused Trigger.dev task via
// wait.completeToken(), then returns 200 immediately.
//
// SECURITY:
//   - HMAC-SHA256 signature verification on the token (rejects forged URLs)
//   - HMAC check happens BEFORE the try/catch that swallows delivery errors
//
// RESPONSE CONTRACT:
//   - 401 if HMAC verification fails
//   - 400 if request body is not valid JSON
//   - 200 for everything else (even if token delivery fails)
//
// TIMING:
//   Must respond within 3 seconds. No Prisma writes, no blocking operations.
//   Token delivery is fire-and-forget with error swallowing.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { wait } from "@trigger.dev/sdk/v3";
import { verifyWebhookSignature } from "@/lib/webhook-signing";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const resolvedParams = await params;
  const token = decodeURIComponent(resolvedParams.token);
  const sig = req.nextUrl.searchParams.get("sig");

  // ── 1. HMAC verification — BEFORE any error-swallowing try/catch ──────
  if (!verifyWebhookSignature(token, sig)) {
    console.error("[webhook/fal] HMAC verification failed", {
      token: token.slice(0, 20) + "...",
      sigPresent: !!sig,
    });
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  // ── 2. Parse request body ─────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    console.error("[webhook/fal] Failed to parse JSON body", {
      token: token.slice(0, 20) + "...",
    });
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  console.log("[webhook/fal] Received callback", {
    token: token.slice(0, 20) + "...",
    hasBody: !!body,
    status: (body as Record<string, unknown>)?.status,
  });

  // ── 3. Deliver token to Trigger.dev — errors swallowed ────────────────
  // If delivery fails (task already timed out, token invalid, network error),
  // we still return 200 to prevent fal.ai from retrying and causing
  // duplicate webhook deliveries.
  try {
    await wait.completeToken(token, body);
    console.log("[webhook/fal] Token delivered successfully", {
      token: token.slice(0, 20) + "...",
    });
  } catch (err) {
    console.error("[webhook/fal] Token delivery failed (non-fatal)", {
      token: token.slice(0, 20) + "...",
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── 4. Always 200 ────────────────────────────────────────────────────
  return NextResponse.json({ received: true });
}
