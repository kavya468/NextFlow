import { describe, expect, it, vi } from "vitest";
import { readBoundedBody } from "../request-body";

describe("bounded request bodies", () => {
  it("preserves raw bytes", async () => {
    const body = new Uint8Array([0, 255, 10, 123]);
    expect(await readBoundedBody(new Response(body), 4)).toEqual(Buffer.from(body));
  });
  it("rejects declared oversized requests", async () => {
    await expect(readBoundedBody(new Response("", { headers: { "Content-Length": "5000" } }), 4)).rejects.toMatchObject({ status: 413 });
  });
  it("enforces streamed bytes even without Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(3)); controller.enqueue(new Uint8Array(3)); controller.close(); } });
    await expect(readBoundedBody(new Response(stream), 4)).rejects.toMatchObject({ status: 413 });
  });
  it("bounds slow streaming requests", async () => {
    vi.useFakeTimers();
    try {
      const pending = expect(readBoundedBody(new Response(new ReadableStream()), 4)).rejects.toMatchObject({ status: 408 });
      await vi.advanceTimersByTimeAsync(30_000);
      await pending;
    } finally { vi.useRealTimers(); }
  });
});
