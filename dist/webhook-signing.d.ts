/**
 * Generate an HMAC-SHA256 signature for a waitpoint token ID.
 */
export declare function signToken(tokenId: string): string;
/**
 * Verify an HMAC-SHA256 signature against a waitpoint token ID.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export declare function verifyWebhookSignature(tokenId: string, providedSignature: string | null): boolean;
/**
 * Build the full webhook URL for a waitpoint token.
 * This URL is passed to fal.ai as the `webhook_url` in the request body.
 */
export declare function buildWebhookUrl(tokenId: string): string;
