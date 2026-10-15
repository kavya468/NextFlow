import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

const blockedAddresses = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10],
  ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv4");

const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) blockedAddresses.addSubnet(address, prefix, "ipv6");

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blockedAddresses.check(address, "ipv4");
  // Excludes mapped IPv4, local/link-local addresses and translation/tunnel ranges.
  return family === 6 && globalIPv6.check(address, "ipv6") &&
    !blockedAddresses.check(address, "ipv6");
}

interface PublicFetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  maxBytes?: number;
  timeoutMs?: number;
}

/** Bounded HTTP(S) requests to public addresses; GET redirects are revalidated. */
export async function publicFetch(input: string | URL, options: PublicFetchOptions = {}): Promise<Response> {
  const maxBytes = options.maxBytes ?? 100 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("Invalid outbound request limits");
  }
  if (options.body && Buffer.byteLength(options.body) > 1024 * 1024) {
    throw new Error("Outbound request body is too large");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Outbound request timed out")), timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  let onAbort: () => void = () => {};

  async function run(): Promise<Response> {
    let url = new URL(input);
    for (let redirect = 0; redirect <= 5; redirect += 1) {
      signal.throwIfAborted();
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Only public HTTP(S) URLs without credentials are allowed");
      }
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const family = isIP(hostname);
      const addresses = family ? [{ address: hostname, family }] :
        await lookup(hostname, { all: true, verbatim: true });
      signal.throwIfAborted();
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new Error("Outbound URL must resolve only to public addresses");
      }
      const pinned = addresses[0];
      const result = await new Promise<Response | URL>((resolve, reject) => {
        const request = url.protocol === "https:" ? httpsRequest : httpRequest;
        const req = request(url, {
          method: options.method ?? "GET",
          headers: { ...options.headers, "accept-encoding": "identity" },
          agent: false,
          family: pinned.family,
          // Keep the URL hostname for Host/TLS, but never perform a second DNS lookup.
          lookup: (_hostname, _lookupOptions, callback) => callback(null, pinned.address, pinned.family),
          signal,
        }, (res) => {
          res.on("error", reject);
          const status = res.statusCode ?? 502;
          if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
            res.destroy();
            // Callback payloads must not be forwarded to another endpoint by a redirect.
            if ((options.method ?? "GET") !== "GET" || redirect === 5) {
              reject(new Error("Outbound redirect is not allowed"));
              return;
            }
            try { resolve(new URL(res.headers.location, url)); }
            catch { reject(new Error("Invalid outbound redirect URL")); }
            return;
          }
          const contentLength = Number(res.headers["content-length"]);
          const encoding = res.headers["content-encoding"];
          if (contentLength > maxBytes || (encoding && encoding !== "identity")) {
            res.destroy();
            reject(new Error(contentLength > maxBytes ? "Outbound response is too large" : "Encoded outbound responses are not supported"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxBytes) {
              res.destroy();
              reject(new Error("Outbound response is too large"));
            } else chunks.push(chunk);
          });
          res.on("end", () => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers)) {
              if (value !== undefined) {
                for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
              }
            }
            try {
              const body = [204, 205, 304].includes(status) ? null : new Uint8Array(Buffer.concat(chunks));
              resolve(new Response(body, { status, headers }));
            } catch (error) { reject(error); }
          });
        });
        req.on("error", reject);
        req.end(options.body);
      });
      if (result instanceof Response) return result;
      url = result;
    }
    throw new Error("Too many outbound redirects");
  }

  try {
    signal.throwIfAborted();
    return await Promise.race([
      run(),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

// Downloaded media may itself be a playlist: deny manifests and image filename sequences.
export const LOCAL_MEDIA_INPUT_OPTIONS = [
  "-protocol_whitelist", "file",
  "-format_whitelist", "mov,matroska,webm,avi,flv,ogg,mpeg,mpegvideo,mp3,wav,flac,aac,jpeg_pipe,png_pipe,apng,webp_pipe,gif,bmp_pipe,tiff_pipe",
];
