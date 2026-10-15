export class RequestBodyError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Content-Length is only an early check; enforce the limit on streamed bytes too.
export async function readBoundedBody(request: Pick<Request, "body" | "headers">, maxBytes: number): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    throw new RequestBodyError("Request is too large", 413);
  }
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RequestBodyError("Request body timed out", 408)), 30_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > maxBytes) throw new RequestBodyError("Request is too large", 413);
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}
