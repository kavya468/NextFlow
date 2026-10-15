import { z } from "zod";
import { authorizeUpload, MAX_UPLOAD_BYTES, signUpload } from "@/lib/upload-policy";
import { readBoundedBody, RequestBodyError } from "@/lib/request-body";

export const maxDuration = 120;
const fileResult = z.object({ ssl_url: z.string().url() });
const assemblySchema = z.object({
  ok: z.string().optional(), error: z.string().optional(), assembly_ssl_url: z.string().url().optional(),
  results: z.record(z.string(), z.array(fileResult)).optional(), uploads: z.array(fileResult).optional(),
});
const mediaType = /^(image\/(jpeg|png|webp|gif|avif|heic|heif)|video\/(mp4|webm|quicktime|mpeg|ogg)|audio\/(mpeg|mp3|wav|x-wav|wave|mp4|aac|ogg|webm|flac|x-flac|x-m4a))$/;

async function pollAssembly(assemblyUrl: string, signal: AbortSignal) {
  const url = new URL(assemblyUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !(url.hostname === "api2.transloadit.com" || url.hostname.endsWith(".transloadit.com"))) {
    throw new Error("Unexpected upload status URL");
  }
  while (true) {
    const response = await fetch(url, { signal, redirect: "error" });
    if (!response.ok) throw new Error("Upload status unavailable");
    const data = assemblySchema.parse(await response.json());
    if (data.error) throw new Error("Upload processing failed");
    if (data.ok === "ASSEMBLY_COMPLETED") return data;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    signal.throwIfAborted();
  }
}

export async function POST(request: Request) {
  const denied = await authorizeUpload();
  if (denied) return denied;
  try {
    const bytes = await readBoundedBody(request, MAX_UPLOAD_BYTES + 64 * 1024);
    let form: FormData;
    try {
      form = await new Response(new Uint8Array(bytes), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    } catch {
      return Response.json({ error: "Invalid multipart upload" }, { status: 400 });
    }
    const file = form.get("file");
    if (!(file instanceof File) || Array.from(form.values()).filter((value) => value instanceof File).length !== 1 || !mediaType.test(file.type) || file.size === 0) {
      return Response.json({ error: "Upload one supported image, video, or audio file" }, { status: 400 });
    }
    if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "Maximum file size is 50 MB" }, { status: 413 });
    const isImage = file.type.startsWith("image/");
    const steps = {
      ":original": { robot: "/upload/handle" },
      validated: { use: ":original", robot: "/file/filter", accepts: [["${file.mime}", "regex", "^(image|video|audio)/"]], error_on_decline: true },
      ...(isImage ? { resized: { robot: "/image/resize", use: "validated", resize_strategy: "fit", width: 1920, height: 1080, result: true } } : {}),
    };
    const signed = signUpload(steps);
    const uploadForm = new FormData();
    uploadForm.append("params", signed.params);
    uploadForm.append("signature", signed.signature);
    uploadForm.append("file", file, file.name);
    const signal = AbortSignal.timeout(90_000);
    const response = await fetch("https://api2.transloadit.com/assemblies", { method: "POST", body: uploadForm, signal, redirect: "error" });
    if (!response.ok) throw new Error("Upload provider unavailable");
    const assembly = assemblySchema.parse(await response.json());
    if (assembly.error || !assembly.assembly_ssl_url) throw new Error("Upload was rejected");
    const result = await pollAssembly(assembly.assembly_ssl_url, signal);
    const url = result.results?.[isImage ? "resized" : ":original"]?.[0]?.ssl_url ?? result.uploads?.[0]?.ssl_url;
    if (!url || new URL(url).protocol !== "https:") throw new Error("Upload has no secure result URL");
    return Response.json({ url });
  } catch (error) {
    if (error instanceof RequestBodyError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Upload failed. Please try again." }, { status: 502 });
  }
}
