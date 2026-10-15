import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";
import { z } from "zod";
import { readBoundedBody } from "./request-body";

const jwksSchema = z.object({ keys: z.array(z.object({ kty: z.literal("OKP"), crv: z.literal("Ed25519"), x: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })).min(1).max(20) });
let cachedKeys: { keys: KeyObject[]; expires: number } | undefined;

async function getKeys() {
  if (cachedKeys && cachedKeys.expires > Date.now()) return cachedKeys.keys;
  const response = await fetch("https://rest.fal.ai/.well-known/jwks.json", { signal: AbortSignal.timeout(5000), redirect: "error", cache: "no-store" });
  if (!response.ok) throw new Error("Provider verification unavailable");
  const jwks = jwksSchema.parse(JSON.parse((await readBoundedBody(response, 64 * 1024)).toString("utf8")));
  const keys = jwks.keys.map((jwk) => createPublicKey({ key: jwk, format: "jwk" }));
  cachedKeys = { keys, expires: Date.now() + 60 * 60_000 };
  return keys;
}

// fal signs these four fields, including the digest of the unparsed request body.
export async function verifyFalWebhook(headers: Headers, rawBody: Buffer): Promise<boolean> {
  const requestId = headers.get("x-fal-webhook-request-id");
  const userId = headers.get("x-fal-webhook-user-id");
  const timestamp = headers.get("x-fal-webhook-timestamp");
  const signature = headers.get("x-fal-webhook-signature");
  if (!requestId || !userId || !timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  if (!Number.isSafeInteger(Number(timestamp)) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const message = Buffer.from([requestId, userId, timestamp, createHash("sha256").update(rawBody).digest("hex")].join("\n"));
  const signatureBytes = Buffer.from(signature, "hex");
  return (await getKeys()).some((key) => verify(null, message, key, signatureBytes));
}
