import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/webhook-signing";
const mocks = vi.hoisted(() => ({ completeToken: vi.fn() }));
vi.mock("@trigger.dev/sdk/v3", () => ({ wait: mocks }));
vi.mock("@trigger.dev/sdk", () => ({ wait: mocks }));
import { POST } from "@/app/api/webhooks/fal/[token]/route";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const payload = { request_id: "request1", status: "OK", payload: { images: [{ url: "https://cdn.example.com/image" }] } };
const context = { params: Promise.resolve({ token: "token1" }) };

function request(body = JSON.stringify(payload), signed = true, age = 0) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signed) {
    const timestamp = String(Math.floor(Date.now() / 1000) + age);
    const message = ["request1", "fal-user", timestamp, createHash("sha256").update(body).digest("hex")].join("\n");
    headers.set("x-fal-webhook-request-id", "request1");
    headers.set("x-fal-webhook-user-id", "fal-user");
    headers.set("x-fal-webhook-timestamp", timestamp);
    headers.set("x-fal-webhook-signature", sign(null, Buffer.from(message), privateKey).toString("hex"));
  }
  return new NextRequest(`http://localhost/api/webhooks/fal/token1?sig=${signToken("token1")}`, { method: "POST", body, headers });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FAL_WEBHOOK_SECRET", "test-secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ keys: [publicKey.export({ format: "jwk" })] })));
  mocks.completeToken.mockResolvedValue({ success: true });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("fal callback authentication", () => {
  it("rejects an unsigned body even with a valid token URL", async () => {
    expect((await POST(request(undefined, false), context)).status).toBe(401);
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
  it.each([-301, 301])("rejects callbacks outside the freshness window (%s seconds)", async (age) => {
    expect((await POST(request(undefined, true, age), context)).status).toBe(401);
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
  it("rejects body tampering", async () => {
    const valid = request();
    const altered = new NextRequest(valid.url, { method: "POST", headers: valid.headers, body: JSON.stringify({ ...payload, status: "ERROR" }) });
    expect((await POST(altered, context)).status).toBe(401);
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
  it.each(["00", "x".repeat(128)])("rejects malformed provider signatures", async (signature) => {
    const req = request(); req.headers.set("x-fal-webhook-signature", signature);
    expect((await POST(req, context)).status).toBe(401);
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
  it("rejects malformed signed JSON", async () => {
    expect((await POST(request("{"), context)).status).toBe(400);
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
  it("rejects a signed oversized body", async () => {
    const req = request(); req.headers.set("content-length", String(3 * 1024 * 1024));
    expect((await POST(req, context)).status).toBe(413);
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
  it.each(["OK", "ERROR"])("delivers a valid signed %s callback", async (status) => {
    const body = { ...payload, status };
    expect((await POST(request(JSON.stringify(body)), context)).status).toBe(200);
    expect(mocks.completeToken).toHaveBeenCalledWith("token1", body);
  });
  it("allows retries instead of acknowledging lost token delivery", async () => {
    mocks.completeToken.mockRejectedValue(new Error("network unavailable"));
    expect((await POST(request(), context)).status).toBe(503);
  });
  it("rejects an invalid routing signature before JWKS or token calls", async () => {
    const req = request(); req.nextUrl.searchParams.set("sig", "invalid");
    expect((await POST(req, context)).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.completeToken).not.toHaveBeenCalled();
  });
});
