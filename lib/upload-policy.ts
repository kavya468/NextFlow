import { auth } from "@clerk/nextjs/server";
import { Ratelimit } from "@unkey/ratelimit";
import { createHmac, randomUUID } from "node:crypto";

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export async function authorizeUpload(): Promise<Response | null> {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Sign in to upload media" }, { status: 401 });
  const rootKey = process.env.UNKEY_ROOT_KEY;
  if (!rootKey) return Response.json({ error: "Uploads are temporarily unavailable" }, { status: 503 });
  try {
    const limiter = new Ratelimit({
      rootKey, namespace: "nextflow.upload", limit: 20, duration: "1m",
      disableTelemetry: true,
      onError: (error) => { throw error; },
    });
    const result = await limiter.limit(userId);
    if (!result.success) return Response.json({ error: "Upload limit reached. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
    return null;
  } catch {
    return Response.json({ error: "Uploads are temporarily unavailable" }, { status: 503 });
  }
}

export function signUpload(steps: Record<string, unknown>) {
  const key = process.env.NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY;
  const secret = process.env.TRANSLOADIT_AUTH_SECRET;
  if (!key || !secret) throw new Error("Upload service is not configured");
  const params = JSON.stringify({
    auth: { key, expires: new Date(Date.now() + 5 * 60_000).toISOString(), max_size: MAX_UPLOAD_BYTES + 64 * 1024, max_number_of_files: 1 },
    nonce: randomUUID(), steps,
  });
  return { params, signature: `sha384:${createHmac("sha384", secret).update(params).digest("hex")}` };
}
