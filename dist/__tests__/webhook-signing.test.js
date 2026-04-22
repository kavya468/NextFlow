"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const webhook_signing_1 = require("../webhook-signing");
const TEST_SECRET = "test-webhook-secret-key-for-hmac-signing";
const TEST_APP_URL = "https://my-app.ngrok.dev";
(0, vitest_1.beforeEach)(() => {
    vitest_1.vi.stubEnv("FAL_WEBHOOK_SECRET", TEST_SECRET);
    vitest_1.vi.stubEnv("NEXT_PUBLIC_APP_URL", TEST_APP_URL);
});
(0, vitest_1.afterEach)(() => {
    vitest_1.vi.unstubAllEnvs();
});
// ============================================================================
// signToken
// ============================================================================
(0, vitest_1.describe)("signToken", () => {
    (0, vitest_1.it)("returns a hex string", () => {
        const sig = (0, webhook_signing_1.signToken)("token-123");
        (0, vitest_1.expect)(sig).toMatch(/^[0-9a-f]+$/);
    });
    (0, vitest_1.it)("returns consistent output for the same input", () => {
        const sig1 = (0, webhook_signing_1.signToken)("token-abc");
        const sig2 = (0, webhook_signing_1.signToken)("token-abc");
        (0, vitest_1.expect)(sig1).toBe(sig2);
    });
    (0, vitest_1.it)("returns different output for different inputs", () => {
        const sig1 = (0, webhook_signing_1.signToken)("token-abc");
        const sig2 = (0, webhook_signing_1.signToken)("token-xyz");
        (0, vitest_1.expect)(sig1).not.toBe(sig2);
    });
    (0, vitest_1.it)("throws when FAL_WEBHOOK_SECRET is not set", () => {
        vitest_1.vi.stubEnv("FAL_WEBHOOK_SECRET", "");
        (0, vitest_1.expect)(() => (0, webhook_signing_1.signToken)("token-123")).toThrow("FAL_WEBHOOK_SECRET");
    });
});
// ============================================================================
// verifyWebhookSignature
// ============================================================================
(0, vitest_1.describe)("verifyWebhookSignature", () => {
    (0, vitest_1.it)("returns true for a valid signature", () => {
        const token = "waitpoint_abc123def456";
        const sig = (0, webhook_signing_1.signToken)(token);
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)(token, sig)).toBe(true);
    });
    (0, vitest_1.it)("returns false for a tampered signature", () => {
        const token = "waitpoint_abc123def456";
        const sig = (0, webhook_signing_1.signToken)(token);
        const tampered = sig.slice(0, -4) + "ffff";
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)(token, tampered)).toBe(false);
    });
    (0, vitest_1.it)("returns false for a signature from a different token", () => {
        const sig = (0, webhook_signing_1.signToken)("token-OTHER");
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)("token-REAL", sig)).toBe(false);
    });
    (0, vitest_1.it)("returns false when signature is null", () => {
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)("token-123", null)).toBe(false);
    });
    (0, vitest_1.it)("returns false when signature is empty string", () => {
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)("token-123", "")).toBe(false);
    });
    (0, vitest_1.it)("returns false for non-hex signature", () => {
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)("token-123", "not-valid-hex!!!")).toBe(false);
    });
    (0, vitest_1.it)("returns false for signature of wrong length", () => {
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)("token-123", "abcd")).toBe(false);
    });
});
// ============================================================================
// buildWebhookUrl
// ============================================================================
(0, vitest_1.describe)("buildWebhookUrl", () => {
    (0, vitest_1.it)("builds a URL with the correct structure", () => {
        const url = (0, webhook_signing_1.buildWebhookUrl)("waitpoint_abc123");
        (0, vitest_1.expect)(url).toMatch(/^https:\/\/my-app\.ngrok\.dev\/api\/webhooks\/fal\/waitpoint_abc123\?sig=[0-9a-f]+$/);
    });
    (0, vitest_1.it)("includes a valid HMAC signature in the query string", () => {
        const token = "waitpoint_test_token";
        const url = (0, webhook_signing_1.buildWebhookUrl)(token);
        const parsedUrl = new URL(url);
        const sig = parsedUrl.searchParams.get("sig");
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)(token, sig)).toBe(true);
    });
    (0, vitest_1.it)("URL-encodes special characters in token ID", () => {
        const token = "token/with spaces&special=chars";
        const url = (0, webhook_signing_1.buildWebhookUrl)(token);
        (0, vitest_1.expect)(url).not.toContain("token/with spaces");
        (0, vitest_1.expect)(url).toContain(encodeURIComponent(token));
    });
    (0, vitest_1.it)("throws when NEXT_PUBLIC_APP_URL is not set", () => {
        vitest_1.vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
        (0, vitest_1.expect)(() => (0, webhook_signing_1.buildWebhookUrl)("token-123")).toThrow("NEXT_PUBLIC_APP_URL");
    });
});
// ============================================================================
// Roundtrip: build URL → extract token + sig → verify
// ============================================================================
(0, vitest_1.describe)("roundtrip verification", () => {
    (0, vitest_1.it)("a URL built by buildWebhookUrl can be verified by verifyWebhookSignature", () => {
        const tokenId = "waitpoint_roundtrip_test_12345";
        const url = (0, webhook_signing_1.buildWebhookUrl)(tokenId);
        const parsedUrl = new URL(url);
        const pathSegments = parsedUrl.pathname.split("/");
        const extractedToken = decodeURIComponent(pathSegments[pathSegments.length - 1]);
        const extractedSig = parsedUrl.searchParams.get("sig");
        (0, vitest_1.expect)(extractedToken).toBe(tokenId);
        (0, vitest_1.expect)((0, webhook_signing_1.verifyWebhookSignature)(extractedToken, extractedSig)).toBe(true);
    });
});
