import { NextRequest } from "next/server";
import { wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { verifyWebhookSignature } from "@/lib/webhook-signing";
import { verifyFalWebhook } from "@/lib/fal-webhook";
import { readBoundedBody, RequestBodyError } from "@/lib/request-body";

const callbackSchema = z.object({ request_id: z.string().min(1), status: z.enum(["OK", "ERROR"]) }).passthrough();

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!verifyWebhookSignature(token, req.nextUrl.searchParams.get("sig"))) {
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  try {
    const rawBody = await readBoundedBody(req, 2 * 1024 * 1024);
    if (!(await verifyFalWebhook(req.headers, rawBody))) {
      return Response.json({ error: "Invalid provider signature" }, { status: 401 });
    }
    const parsed = callbackSchema.safeParse(JSON.parse(rawBody.toString("utf8")));
    if (!parsed.success) return Response.json({ error: "Invalid callback payload" }, { status: 400 });
    // Trigger waitpoints accept completion once; failed delivery must remain retryable.
    await wait.completeToken(token, parsed.data);
    return Response.json({ received: true });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    return Response.json({ error: "Callback delivery temporarily unavailable" }, { status: 503 });
  }
}
