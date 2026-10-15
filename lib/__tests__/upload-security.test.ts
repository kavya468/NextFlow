import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@unkey/ratelimit", () => ({ Ratelimit: class { limit = mocks.limit; } }));
import { POST as sign } from "@/app/api/upload/sign/route";
import { POST as upload } from "@/app/api/upload/route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_TRANSLOADIT_AUTH_KEY", "test-key");
  vi.stubEnv("TRANSLOADIT_AUTH_SECRET", "test-secret");
  vi.stubEnv("UNKEY_ROOT_KEY", "test-unkey");
  mocks.auth.mockResolvedValue({ userId: "user1" });
  mocks.limit.mockResolvedValue({ success: true });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const json = (body: unknown) => new Request("http://localhost/api/upload/sign", { method: "POST", body: JSON.stringify(body) });

describe("upload security", () => {
  it.each([sign, upload])("rejects anonymous requests before reading their body", async (handler) => {
    mocks.auth.mockResolvedValue({ userId: null });
    const request = json({ type: "image" });
    const bodyRead = vi.spyOn(request, "json");
    const formRead = vi.spyOn(request, "formData");
    expect((await handler(request)).status).toBe(401);
    expect(bodyRead).not.toHaveBeenCalled();
    expect(formRead).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([{ type: "executable" }, { templateId: "arbitrary-template", type: "image" }, {}])("rejects unsafe signing instructions %j", async (body) => {
    expect((await sign(json(body))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["image", "video"])("creates one bounded %s assembly without revealing reusable signing credentials", async (type) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ assembly_ssl_url: "https://api2.transloadit.com/assemblies/test", tus_url: "https://api2.transloadit.com/resumable/files/" }));
    const response = await sign(json({ type, size: 4 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ assemblyUrl: "https://api2.transloadit.com/assemblies/test", tusUrl: "https://api2.transloadit.com/resumable/files/" });
    expect(body.signature).toBeUndefined();
    expect(body.params).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const providerForm = vi.mocked(fetch).mock.calls[0][1]?.body as FormData;
    expect(providerForm.get("num_expected_upload_files")).toBe("1");
    const params = JSON.parse(String(providerForm.get("params")));
    expect(params.auth.max_size).toBe(50 * 1024 * 1024 + 64 * 1024);
    expect(params.auth.max_number_of_files).toBe(1);
    expect(params.steps[`${type}_exported`]).toBeDefined();
  });
  it.each([0, -1, 50 * 1024 * 1024 + 1, "4"])("rejects invalid direct upload size %s before provider calls", async (size) => {
    expect((await sign(json({ type: "image", size }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a malformed JSON request", async () => {
    expect((await sign(new Request("http://localhost", { method: "POST", body: "{" }))).status).toBe(400);
  });
  it("enforces the authenticated user's shared upload rate limit", async () => {
    mocks.limit.mockResolvedValue({ success: false });
    expect((await sign(json({ type: "image" }))).status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("fails closed if the limiter is unavailable", async () => {
    mocks.limit.mockRejectedValue(new Error("Unavailable"));
    expect((await sign(json({ type: "image" }))).status).toBe(503);
  });
  it("fails closed when rate-limit configuration is absent", async () => {
    vi.stubEnv("UNKEY_ROOT_KEY", "");
    expect((await sign(json({ type: "image" }))).status).toBe(503);
    expect(mocks.limit).not.toHaveBeenCalled();
  });
  it.each([sign, upload])("rejects excessive request bodies", async (handler) => {
    const request = json({ type: "image" }); request.headers.set("Content-Length", String(60 * 1024 * 1024));
    expect((await handler(request)).status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["not-a-file", new File(["data"], "script.html", { type: "text/html" })])("rejects nonmedia multipart values", async (file) => {
    const form = new FormData(); form.set("file", file);
    expect((await upload(new Request("http://localhost", { method: "POST", body: form }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["image/png", "video/mp4", "audio/mpeg"])("preserves authenticated %s multipart upload", async (type) => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ assembly_ssl_url: "https://api2.transloadit.com/assemblies/test" }))
      .mockResolvedValueOnce(Response.json({ ok: "ASSEMBLY_COMPLETED", uploads: [{ ssl_url: "https://cdn.example.com/media" }] }));
    const form = new FormData(); form.set("file", new File(["media"], "media", { type }));
    const response = await upload(new Request("http://localhost", { method: "POST", body: form }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://cdn.example.com/media" });
  });
});
