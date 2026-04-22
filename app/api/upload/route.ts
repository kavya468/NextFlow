// ============================================================================
// app/api/upload/route.ts — Media Upload via Transloadit REST API
// ============================================================================
//
// Accepts multipart/form-data with a single "file" field, uploads it to
// Transloadit for processing, polls until completion, and returns:
//   { url: "https://cdn-url..." }
//
// ARCHITECTURAL NOTE:
//   This uses the raw Transloadit REST API (not the Node.js SDK) to avoid
//   SDK compatibility issues inside Next.js API routes. This is the exact
//   same battle-tested pattern used in src/trigger/media.ts.
// ============================================================================

import { NextResponse } from 'next/server';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Route Segment Config — raise body size limit for video uploads (default 4MB)
// ---------------------------------------------------------------------------
export const maxDuration = 120; // seconds — video upload + Transloadit polling


// ---------------------------------------------------------------------------
// Transloadit helpers — identical to src/trigger/media.ts
// ---------------------------------------------------------------------------

function createTransloaditParams(
  authKey: string,
  authSecret: string,
  steps: Record<string, unknown>
) {
  const params = {
    auth: {
      key: authKey,
      expires:
        new Date(Date.now() + 1000 * 60 * 30)
          .toISOString()
          .replace("T", " ")
          .slice(0, 19) + "+00:00",
    },
    steps,
  };

  const paramsString = JSON.stringify(params);
  const signature = crypto
    .createHmac("sha384", authSecret)
    .update(paramsString)
    .digest("hex");

  return { params: paramsString, signature: `sha384:${signature}` };
}

async function pollAssembly(
  assemblyUrl: string,
  maxWait = 120000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const res = await fetch(assemblyUrl);
    const data = await res.json();

    if (data.ok === "ASSEMBLY_COMPLETED") {
      return data;
    }
    if (data.error) {
      throw new Error(`Transloadit assembly error: ${data.error}`);
    }

    // Poll every 2 seconds
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Transloadit assembly timed out after 120s");
}

// ---------------------------------------------------------------------------
// POST handler — accepts FormData with "file" field
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    // ── 1. Extract file from FormData ─────────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseError: any) {
      console.error("[upload/route] Failed to parse FormData:", parseError);
      return NextResponse.json(
        {
          error:
            "Failed to parse upload. The file may be too large (max ~50MB) or the request was interrupted. " +
            "Try a smaller file or paste a URL instead.",
        },
        { status: 413 }
      );
    }
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // ── 2. Validate env keys ──────────────────────────────────────────────
    const authKey = process.env.NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY;
    const authSecret = process.env.TRANSLOADIT_AUTH_SECRET;

    if (!authKey || !authSecret) {
      console.error(
        "[upload/route] NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY or TRANSLOADIT_AUTH_SECRET is missing from .env"
      );
      return NextResponse.json(
        {
          error:
            "Server configuration error: Transloadit API keys are not set. " +
            "Add NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY and TRANSLOADIT_AUTH_SECRET to your .env file.",
        },
        { status: 500 }
      );
    }

    // ── 3. Build Transloadit assembly steps ───────────────────────────────
    const isVideo = file.type.startsWith("video/");

    const steps = isVideo
      ? {
          ":original": { robot: "/upload/handle" },
        }
      : {
          ":original": { robot: "/upload/handle" },
          resized: {
            robot: "/image/resize",
            use: ":original",
            resize_strategy: "fit",
            width: 1920,
            height: 1080,
            result: true,
          },
        };

    // ── 4. Create signed assembly request ─────────────────────────────────
    const { params, signature } = createTransloaditParams(
      authKey,
      authSecret,
      steps
    );

    const uploadForm = new FormData();
    uploadForm.append("params", params);
    uploadForm.append("signature", signature);
    uploadForm.append("file", file, file.name);

    console.log("[upload/route] Creating Transloadit assembly...", {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      isVideo,
    });

    // ── 5. POST to Transloadit assemblies endpoint ────────────────────────
    const assemblyRes = await fetch(
      "https://api2.transloadit.com/assemblies",
      {
        method: "POST",
        body: uploadForm,
      }
    );

    const assembly = await assemblyRes.json();

    if (assembly.error) {
      console.error("[upload/route] Assembly creation failed:", assembly.error);
      throw new Error(`Transloadit: ${assembly.error}`);
    }

    console.log("[upload/route] Assembly created, polling for completion...", {
      assemblyId: assembly.assembly_id,
      assemblyUrl: assembly.assembly_ssl_url,
    });

    // ── 6. Poll until the assembly finishes processing ────────────────────
    const result = await pollAssembly(assembly.assembly_ssl_url);

    // ── 7. Extract the CDN URL from results ───────────────────────────────
    const stepKey = isVideo ? ":original" : "resized";
    const stepResults = result.results?.[stepKey];

    if (stepResults?.[0]?.ssl_url) {
      const cdnUrl = stepResults[0].ssl_url;
      console.log("[upload/route] Upload complete:", cdnUrl);
      return NextResponse.json({ url: cdnUrl });
    }

    // Fallback: use the original upload URL if no processing step produced output
    if (result.uploads?.[0]?.ssl_url) {
      const fallbackUrl = result.uploads[0].ssl_url;
      console.log("[upload/route] Using fallback upload URL:", fallbackUrl);
      return NextResponse.json({ url: fallbackUrl });
    }

    // Should never reach here if Transloadit is configured correctly
    console.error(
      "[upload/route] Assembly completed but no URL found in results:",
      JSON.stringify(result.results, null, 2)
    );
    return NextResponse.json(
      { error: "Upload processed but no CDN URL was returned by Transloadit" },
      { status: 500 }
    );
  } catch (error: any) {
    console.error("[upload/route] Upload failed:", error);
    return NextResponse.json(
      { error: error.message || "Unknown upload error" },
      { status: 500 }
    );
  }
}
