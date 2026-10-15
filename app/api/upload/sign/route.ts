import { z } from "zod";
import { authorizeUpload, signUpload } from "@/lib/upload-policy";
import { readBoundedBody, RequestBodyError } from "@/lib/request-body";
import { transloaditUrl } from "@/lib/transloadit-url";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-policy";

const signingInput = z.object({ type: z.enum(["image", "video"]), size: z.number().int().positive().max(MAX_UPLOAD_BYTES) }).strict();
const assemblySchema = z.object({ assembly_ssl_url: z.string().url(), tus_url: z.string().url() });

export async function POST(request: Request) {
  const denied = await authorizeUpload();
  if (denied) return denied;
  try {
    const parsed = signingInput.safeParse(JSON.parse((await readBoundedBody(request, 1024)).toString("utf8")));
    if (!parsed.success) return Response.json({ error: "Choose image or video upload" }, { status: 400 });
    const steps = parsed.data.type === "image"
      ? { image_exported: { use: ":original", robot: "/image/resize", resize_strategy: "fit", width: 1920, height: 1080, result: true } }
      : { video_exported: { use: ":original", robot: "/file/filter", accepts: [["${file.mime}", "regex", "^video/"]], error_on_decline: true, result: true } };
    // Create one assembly here: never expose reusable assembly-creation credentials.
    const signed = signUpload(steps);
    const form = new FormData();
    form.set("params", signed.params);
    form.set("signature", signed.signature);
    form.set("num_expected_upload_files", "1");
    const response = await fetch("https://api2.transloadit.com/assemblies", { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Upload provider unavailable");
    const assembly = assemblySchema.parse(JSON.parse((await readBoundedBody(response, 1024 * 1024)).toString("utf8")));
    return Response.json({ assemblyUrl: transloaditUrl(assembly.assembly_ssl_url), tusUrl: transloaditUrl(assembly.tus_url) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON" }, { status: 400 });
    return Response.json({ error: "Uploads are temporarily unavailable" }, { status: 503 });
  }
}
