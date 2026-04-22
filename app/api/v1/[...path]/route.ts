import { NextRequest } from "next/server";
import { publicApiRouter } from "@/server/trpc/routers/public-api";
import { createOpenApiContext } from "@/server/trpc/trpc";
import { createOpenApiFetchHandler } from "trpc-to-openapi";

export async function GET(req: NextRequest) {
  return handleRequest(req);
}

export async function POST(req: NextRequest) {
  // Mintlify's API playground sends an empty body when all body fields
  // are optional. trpc-to-openapi then fails with "Unexpected end of
  // JSON input" when trying to parse it. Ensure a valid JSON body exists.
  const cloned = req.clone();
  const raw = await cloned.text();
  const hasBody = raw.trim().length > 0;

  const safeReq = hasBody
    ? req
    : new NextRequest(req.url, {
        method: req.method,
        headers: req.headers,
        body: "{}",
      });

  return handleRequest(safeReq);
}

async function handleRequest(req: NextRequest) {
  return createOpenApiFetchHandler({
    endpoint: "/api",
    router: publicApiRouter,
    createContext: () => createOpenApiContext({ req }),
    req,
  });
}
