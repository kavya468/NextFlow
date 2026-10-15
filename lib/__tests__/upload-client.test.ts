import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadDirectMedia } from "../upload-client";
import { transloaditUrl } from "../transloadit-url";

const assemblyUrl = "https://api2-test.transloadit.com/assemblies/test";
const tusUrl = "https://api2-test.transloadit.com/resumable/files/";
const file = new File(["media"], "café.png", { type: "image/png" });
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(Response.json({ assemblyUrl, tusUrl }))
    .mockResolvedValueOnce(new Response(null, { status: 201, headers: { Location: `${tusUrl}one-file` } }))
    .mockResolvedValueOnce(new Response(null, { status: 204, headers: { "Upload-Offset": String(file.size) } }))
    .mockResolvedValueOnce(Response.json({ ok: "ASSEMBLY_COMPLETED", results: { image_exported: [{ ssl_url: "https://cdn.example.com/image.png" }] } })));
});
afterEach(() => vi.unstubAllGlobals());
it("uploads to the one server-created assembly and preserves Unicode filenames", async () => {
  await expect(uploadDirectMedia(file, "image")).resolves.toBe("https://cdn.example.com/image.png");
  const calls = vi.mocked(fetch).mock.calls;
  expect(calls).toHaveLength(4);
  expect(JSON.parse(String(calls[0][1]?.body))).toEqual({ type: "image", size: file.size });
  expect(calls[1][0]).toBe(tusUrl);
  expect(new Headers(calls[1][1]?.headers).get("Upload-Metadata")).toContain(Buffer.from(file.name).toString("base64"));
  expect(calls[2][1]?.method).toBe("PATCH");
  expect(calls[2][1]?.body).toBe(file);
  expect(calls.every(([url]) => !String(url).endsWith("/assemblies"))).toBe(true);
});
it.each(["http://api2.transloadit.com/x", "https://evil.example/x", "https://api2.transloadit.com.evil.example/x", "https://user:pass@api2.transloadit.com/x", "https://api2.transloadit.com:8080/x"])("rejects unsafe capability URL %s", (url) => {
  expect(() => transloaditUrl(url)).toThrow();
});
it("rejects an oversized file before creating an assembly", async () => {
  const large = new File([], "big.png");
  Object.defineProperty(large, "size", { value: 50 * 1024 * 1024 + 1 });
  await expect(uploadDirectMedia(large, "image")).rejects.toThrow("50 MB");
  expect(fetch).not.toHaveBeenCalled();
});
it("stops after a denied assembly request", async () => {
  vi.mocked(fetch).mockReset().mockResolvedValue(Response.json({ error: "Sign in to upload media" }, { status: 401 }));
  await expect(uploadDirectMedia(file, "image")).rejects.toThrow("Sign in");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("does not poll after an incomplete upload", async () => {
  vi.mocked(fetch).mockReset()
    .mockResolvedValueOnce(Response.json({ assemblyUrl, tusUrl }))
    .mockResolvedValueOnce(new Response(null, { status: 201, headers: { Location: `${tusUrl}one-file` } }))
    .mockResolvedValueOnce(new Response(null, { status: 204, headers: { "Upload-Offset": "1" } }));
  await expect(uploadDirectMedia(file, "image")).rejects.toThrow("did not complete");
  expect(fetch).toHaveBeenCalledTimes(3);
});
