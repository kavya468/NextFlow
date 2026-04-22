import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signToken,
  verifyWebhookSignature,
  buildWebhookUrl,
} from "../webhook-signing";

const TEST_SECRET = "test-webhook-secret-key-for-hmac-signing";
const TEST_APP_URL = "https://my-app.ngrok.dev";

beforeEach(() => {
  vi.stubEnv("FAL_WEBHOOK_SECRET", TEST_SECRET);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", TEST_APP_URL);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ============================================================================
// signToken
// ============================================================================

describe("signToken", () => {
  it("returns a hex string", () => {
    const sig = signToken("token-123");
    expect(sig).toMatch(/^[0-9a-f]+$/);
  });

  it("returns consistent output for the same input", () => {
    const sig1 = signToken("token-abc");
    const sig2 = signToken("token-abc");
    expect(sig1).toBe(sig2);
  });

  it("returns different output for different inputs", () => {
    const sig1 = signToken("token-abc");
    const sig2 = signToken("token-xyz");
    expect(sig1).not.toBe(sig2);
  });

  it("throws when FAL_WEBHOOK_SECRET is not set", () => {
    vi.stubEnv("FAL_WEBHOOK_SECRET", "");
    expect(() => signToken("token-123")).toThrow("FAL_WEBHOOK_SECRET");
  });
});

// ============================================================================
// verifyWebhookSignature
// ============================================================================

describe("verifyWebhookSignature", () => {
  it("returns true for a valid signature", () => {
    const token = "waitpoint_abc123def456";
    const sig = signToken(token);
    expect(verifyWebhookSignature(token, sig)).toBe(true);
  });

  it("returns false for a tampered signature", () => {
    const token = "waitpoint_abc123def456";
    const sig = signToken(token);
    const tampered = sig.slice(0, -4) + "ffff";
    expect(verifyWebhookSignature(token, tampered)).toBe(false);
  });

  it("returns false for a signature from a different token", () => {
    const sig = signToken("token-OTHER");
    expect(verifyWebhookSignature("token-REAL", sig)).toBe(false);
  });

  it("returns false when signature is null", () => {
    expect(verifyWebhookSignature("token-123", null)).toBe(false);
  });

  it("returns false when signature is empty string", () => {
    expect(verifyWebhookSignature("token-123", "")).toBe(false);
  });

  it("returns false for non-hex signature", () => {
    expect(verifyWebhookSignature("token-123", "not-valid-hex!!!")).toBe(
      false
    );
  });

  it("returns false for signature of wrong length", () => {
    expect(verifyWebhookSignature("token-123", "abcd")).toBe(false);
  });
});

// ============================================================================
// buildWebhookUrl
// ============================================================================

describe("buildWebhookUrl", () => {
  it("builds a URL with the correct structure", () => {
    const url = buildWebhookUrl("waitpoint_abc123");
    expect(url).toMatch(
      /^https:\/\/my-app\.ngrok\.dev\/api\/webhooks\/fal\/waitpoint_abc123\?sig=[0-9a-f]+$/
    );
  });

  it("includes a valid HMAC signature in the query string", () => {
    const token = "waitpoint_test_token";
    const url = buildWebhookUrl(token);
    const parsedUrl = new URL(url);
    const sig = parsedUrl.searchParams.get("sig");
    expect(verifyWebhookSignature(token, sig)).toBe(true);
  });

  it("URL-encodes special characters in token ID", () => {
    const token = "token/with spaces&special=chars";
    const url = buildWebhookUrl(token);
    expect(url).not.toContain("token/with spaces");
    expect(url).toContain(encodeURIComponent(token));
  });

  it("throws when NEXT_PUBLIC_APP_URL is not set", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(() => buildWebhookUrl("token-123")).toThrow("NEXT_PUBLIC_APP_URL");
  });
});

// ============================================================================
// Roundtrip: build URL → extract token + sig → verify
// ============================================================================

describe("roundtrip verification", () => {
  it("a URL built by buildWebhookUrl can be verified by verifyWebhookSignature", () => {
    const tokenId = "waitpoint_roundtrip_test_12345";
    const url = buildWebhookUrl(tokenId);

    const parsedUrl = new URL(url);
    const pathSegments = parsedUrl.pathname.split("/");
    const extractedToken = decodeURIComponent(
      pathSegments[pathSegments.length - 1]
    );
    const extractedSig = parsedUrl.searchParams.get("sig");

    expect(extractedToken).toBe(tokenId);
    expect(verifyWebhookSignature(extractedToken, extractedSig)).toBe(true);
  });
});
