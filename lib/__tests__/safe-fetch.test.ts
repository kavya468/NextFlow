import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage, RequestOptions } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));

import { publicFetch } from "../safe-fetch";

type Reply = { status?: number; headers?: Record<string, string>; chunks?: string[]; stall?: boolean };
let replies: Reply[];
let connections: Array<{ url: URL; address: string; options: RequestOptions; body?: string }>;

beforeEach(() => {
  vi.clearAllMocks();
  replies = [];
  connections = [];
  mocks.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  mocks.request.mockImplementation((url: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => {
    const req = new EventEmitter() as EventEmitter & { end: (body?: string) => void };
    req.end = (body) => {
      const pinnedLookup = options.lookup as (hostname: string, options: object,
        cb: (error: Error | null, address: string, family: number) => void) => void;
      pinnedLookup(url.hostname, {}, (error, address) => {
        if (error) { req.emit("error", error); return; }
        connections.push({ url, address, options, body });
        const reply = replies.shift() ?? {};
        queueMicrotask(() => {
          const res = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> };
          res.statusCode = reply.status ?? 200;
          res.headers = reply.headers ?? {};
          callback(res as unknown as IncomingMessage);
          if (!reply.stall) {
            for (const chunk of reply.chunks ?? ["media bytes"]) res.write(chunk);
            res.end();
          }
          options.signal?.addEventListener("abort", () => res.destroy(new Error("aborted")), { once: true });
        });
      });
    };
    return req;
  });
});

afterEach(() => vi.restoreAllMocks());

describe("publicFetch outbound boundary", () => {
  it("downloads public HTTPS content while pinning DNS and preserving the TLS hostname", async () => {
    replies.push({ headers: { "content-type": "image/png" }, chunks: ["image"] });
    const response = await publicFetch("https://cdn.example.test/image.png");
    expect(await response.text()).toBe("image");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(connections[0].url.hostname).toBe("cdn.example.test");
    expect(connections[0].address).toBe("93.184.216.34");
    expect(connections[0].options).toMatchObject({ agent: false, family: 4 });
    expect(mocks.lookup).toHaveBeenCalledExactlyOnceWith("cdn.example.test", { all: true, verbatim: true });
  });

  it.each([
    "http://127.0.0.1", "http://2130706433", "http://0x7f000001", "http://0177.0.0.1",
    "http://10.0.0.1", "http://100.64.0.1", "http://169.254.169.254", "http://172.16.0.1",
    "http://192.168.1.1", "http://0.0.0.0", "http://198.18.0.1", "http://192.0.2.1",
    "http://224.0.0.1", "http://255.255.255.255", "http://[::1]", "http://[::]",
    "http://[::ffff:127.0.0.1]", "http://[fe80::1]", "http://[fc00::1]",
    "http://[64:ff9b::7f00:1]", "http://[2002:7f00:1::]", "http://[2001:db8::1]",
    "http://[3fff::1]",
  ])("rejects non-public and encoded addresses: %s", async (url) => {
    await expect(publicFetch(url)).rejects.toThrow("public addresses");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", "ftp://example.test/file", "https://name:secret@example.test/"])(
    "rejects unsupported protocols and URL credentials: %s", async (url) => {
      await expect(publicFetch(url)).rejects.toThrow("HTTP(S)");
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );

  it("rejects a hostname if any A or AAAA answer is internal", async () => {
    mocks.lookup.mockResolvedValue([
      { address: "93.184.216.34", family: 4 }, { address: "::ffff:10.0.0.1", family: 6 },
    ]);
    await expect(publicFetch("https://mixed.example.test")).rejects.toThrow("public addresses");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("supports public IPv6", async () => {
    const response = await publicFetch("https://[2606:4700:4700::1111]/file");
    expect(response.ok).toBe(true);
    expect(connections[0].address).toBe("2606:4700:4700::1111");
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("never resolves again when establishing a validated connection", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    await publicFetch("https://rebinding.example.test");
    expect(mocks.lookup).toHaveBeenCalledTimes(1);
    expect(connections[0].address).toBe("93.184.216.34");
  });

  it("follows a public relative redirect and revalidates its DNS", async () => {
    replies.push({ status: 302, headers: { location: "/signed-image" } }, { chunks: ["image"] });
    const response = await publicFetch("https://cdn.example.test/start");
    expect(await response.text()).toBe("image");
    expect(connections[1].url.pathname).toBe("/signed-image");
    expect(mocks.lookup).toHaveBeenCalledTimes(2);
  });

  it.each(["http://169.254.169.254/latest/meta-data", "https://user:secret@example.test/", "file:///etc/passwd"])(
    "rejects a redirect to a forbidden destination: %s", async (location) => {
      replies.push({ status: 302, headers: { location } });
      await expect(publicFetch("https://cdn.example.test/start")).rejects.toThrow();
      expect(connections).toHaveLength(1);
    },
  );

  it("rejects DNS rebinding on a same-host redirect", async () => {
    mocks.lookup.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
      .mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    replies.push({ status: 302, headers: { location: "/next" } });
    await expect(publicFetch("https://rebinding.example.test/start")).rejects.toThrow("public addresses");
    expect(connections).toHaveLength(1);
  });

  it("caps redirect loops", async () => {
    replies = Array.from({ length: 6 }, () => ({ status: 302, headers: { location: "/loop" } }));
    await expect(publicFetch("https://cdn.example.test/loop")).rejects.toThrow("redirect");
    expect(connections).toHaveLength(6);
  });

  it("preserves callback POST JSON and accepts an empty 204 response", async () => {
    replies.push({ status: 204, chunks: [] });
    const response = await publicFetch("https://callback.example.test/", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: '{"runId":"run-1"}',
    });
    expect(response.status).toBe(204);
    expect(connections[0].options.method).toBe("POST");
    expect(connections[0].body).toBe('{"runId":"run-1"}');
  });

  it("does not forward callback bodies through redirects", async () => {
    replies.push({ status: 307, headers: { location: "https://other.example.test/" } });
    await expect(publicFetch("https://callback.example.test/", { method: "POST", body: "private run data" }))
      .rejects.toThrow("redirect");
    expect(connections).toHaveLength(1);
  });

  it.each([
    { headers: { "content-length": "99" }, chunks: ["small"] },
    { chunks: ["1234", "5678"] },
  ])("bounds declared and streamed response sizes", async (reply) => {
    replies.push(reply);
    await expect(publicFetch("https://cdn.example.test/", { maxBytes: 6 })).rejects.toThrow("too large");
  });

  it("rejects compression rather than expanding an unbounded compressed body", async () => {
    replies.push({ headers: { "content-encoding": "gzip" } });
    await expect(publicFetch("https://cdn.example.test/")).rejects.toThrow("Encoded");
    expect(connections[0].options.headers).toMatchObject({ "accept-encoding": "identity" });
  });

  it("bounds stalled DNS resolution", async () => {
    mocks.lookup.mockImplementation(() => new Promise(() => {}));
    await expect(publicFetch("https://slow.example.test/", { timeoutMs: 10 })).rejects.toThrow("timed out");
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("bounds a stalled response body", async () => {
    replies.push({ stall: true });
    await expect(publicFetch("https://slow.example.test/", { timeoutMs: 10 })).rejects.toThrow("timed out");
  });

  it("honors an existing caller abort signal", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(publicFetch("https://cdn.example.test/", { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
