import { transloaditUrl } from "./transloadit-url";

// Upload bytes into a server-created, single-file assembly without sharing signing credentials.
export async function uploadDirectMedia(file: File, type: "image" | "video"): Promise<string> {
  if (file.size === 0 || file.size > 50 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 50 MB");
  const signal = AbortSignal.timeout(120_000);
  const response = await fetch("/api/upload/sign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, size: file.size }), signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Could not start upload");
  }
  const assembly = await response.json();
  const assemblyUrl = transloaditUrl(assembly.assemblyUrl);
  const tusUrl = transloaditUrl(assembly.tusUrl);
  const base64 = (value: string) => btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(""));
  const created = await fetch(tusUrl, {
    method: "POST", signal, redirect: "error",
    headers: { "Tus-Resumable": "1.0.0", "Upload-Length": String(file.size), "Upload-Metadata": `assembly_url ${base64(assemblyUrl)},filename ${base64(file.name)},fieldname ${base64("file")}` },
  });
  const location = created.headers.get("location");
  if (created.status !== 201 || !location) throw new Error("Could not prepare file upload");
  const uploadUrl = transloaditUrl(new URL(location, tusUrl).href);
  const uploaded = await fetch(uploadUrl, {
    method: "PATCH", body: file, signal, redirect: "error",
    headers: { "Tus-Resumable": "1.0.0", "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" },
  });
  if (uploaded.status !== 204 || Number(uploaded.headers.get("upload-offset")) !== file.size) throw new Error("File upload did not complete");
  while (true) {
    const status = await fetch(assemblyUrl, { signal, redirect: "error" });
    if (!status.ok) throw new Error("Could not check upload status");
    const result = await status.json();
    if (result.error) throw new Error("This file could not be processed");
    if (result.ok === "ASSEMBLY_COMPLETED") {
      const url = result.results?.[`${type}_exported`]?.[0]?.ssl_url || result.uploads?.[0]?.ssl_url;
      if (typeof url !== "string" || new URL(url).protocol !== "https:") throw new Error("Upload has no secure result URL");
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
    signal.throwIfAborted();
  }
}
