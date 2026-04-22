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

  return NextResponse.json(doc);
}
