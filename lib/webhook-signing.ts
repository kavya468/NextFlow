// ============================================================================
// lib/webhook-signing.ts — HMAC Signing & Verification for Webhook URLs
// ============================================================================
//
// Generates and verifies HMAC-SHA256 signatures for webhook token URLs.
// This prevents external actors from constructing arbitrary token URLs
// and resuming arbitrary Trigger.dev waitpoints.
//
// Usage:
//   Task side:   const url = buildWebhookUrl(tokenId);
//   Webhook side: if (!verifyWebhookSignature(tokenId, sig)) return 401;
// ============================================================================

import crypto from "crypto";

export function assertFalRequestId(payload: unknown, expectedRequestId: string) {
  if (!expectedRequestId || !payload || typeof payload !== "object" ||
      !("request_id" in payload) || payload.request_id !== expectedRequestId) {
    throw new Error("Provider callback does not match the queued request");
  }
}

function getSecret(): string {
  const secret = process.env.FAL_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error(
      "FAL_WEBHOOK_SECRET is not set. " +
        "This is required for webhook HMAC signing. " +
        "Add it to your environment variables."
    );
  }
  return secret;
}

/**
 * Generate an HMAC-SHA256 signature for a waitpoint token ID.
 */
export function signToken(tokenId: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(tokenId)
    .digest("hex");
}

/**
 * Verify an HMAC-SHA256 signature against a waitpoint token ID.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(
  tokenId: string,
  providedSignature: string | null
): boolean {
  if (!providedSignature) return false;

  try {
    const expected = signToken(tokenId);

    if (expected.length !== providedSignature.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(providedSignature, "hex")
    );
  } catch {
    return false;
  }
}

/**
 * Build the full webhook URL for a waitpoint token.
 * This URL is passed to fal.ai as the `webhook_url` in the request body.
 */
export function buildWebhookUrl(tokenId: string): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is not set. " +
        "This must be a publicly reachable URL (ngrok for local, Vercel for prod). " +
        "fal.ai needs to POST to this URL when generation completes."
    );
  }

  const sig = signToken(tokenId);
  return `${appUrl}/api/webhooks/fal/${encodeURIComponent(tokenId)}?sig=${sig}`;
}
