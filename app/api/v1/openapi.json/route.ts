import { NextResponse } from "next/server";
import { generateOpenApiDocument } from "trpc-to-openapi";
import { publicApiRouter } from "@/server/trpc/routers/public-api";

export function GET() {
  const doc = generateOpenApiDocument(publicApiRouter, {
    title: "NextFlow API",
    version: "1.0.0",
    baseUrl: "https://next-flow-beta.vercel.app/api",
    description: "REST API for triggering and monitoring AI generation workflows",
    tags: ["Workflows", "Executions", "Credits"],
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "NextFlow API key — generate from Settings → API Keys",
      },
    },
  });

  // ── Post-process: inject request body examples for Mintlify playground ──
  const paths = (doc as any).paths ?? {};

  const executePath = paths["/v1/workflows/{id}/execute"];
  if (executePath?.post?.requestBody?.content?.["application/json"]) {
    executePath.post.requestBody.content["application/json"].example = {
      variables: {
        "text": { text: "Explain why pineapple belongs on pizza." }
      },
      webhook: {
        url: "https://webhook.site/your-unique-id",
        events: ["run.completed", "run.failed"]
      }
    };
  }

  const executeSelectedPath = paths["/v1/workflows/{id}/execute-selected"];
  if (executeSelectedPath?.post?.requestBody?.content?.["application/json"]) {
    executeSelectedPath.post.requestBody.content["application/json"].example = {
      selectedNodeIds: ["hero-image", "hero-crop"],
      variables: {
        "text": { text: "Explain why pineapple belongs on pizza." }
      },
      webhook: {
        url: "https://webhook.site/your-unique-id",
        events: ["run.completed", "run.failed"]
      }
    };
  }

  return NextResponse.json(doc);
}
