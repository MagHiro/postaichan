import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { getServerConfig } from "../config-values.mjs";

export function requestAddress(request: Request) {
  const config = getServerConfig();
  if (config.clientIpStrategy === "none") return null;
  if (config.clientIpStrategy === "trusted_header") {
    const value = request.headers.get(config.trustedClientIpHeader)?.trim();
    return value && isIP(value) ? value : null;
  }
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((part) => part.trim()).filter(Boolean) ?? [];
  if (chain.length < config.trustedProxyHops) return null;
  // Each trusted proxy appends the address of the peer it observed. Walk back
  // exactly the configured proxy count; values further left are untrusted.
  const address = chain[chain.length - config.trustedProxyHops];
  return address && isIP(address) ? address : null;
}

export function rateLimitKey(scope: string, identity: string) {
  return `${scope}:${createHash("sha256").update(identity).digest("hex")}`;
}

export function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false; // Mutations use cookie-bound sessions and must prove their origin.
  try {
    const supplied = new URL(origin);
    const expected = new URL(getServerConfig().appOrigin);
    return ["http:", "https:"].includes(supplied.protocol) && supplied.origin === expected.origin && !supplied.username && !supplied.password;
  } catch { return false; }
}

export class RequestBodyTooLargeError extends Error {
  constructor() { super("Request body too large."); }
}

export async function readBoundedBody(request: Request, maxBytes: number) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) throw new RequestBodyTooLargeError();
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

export async function readJsonBody(request: Request) {
  try {
    // Enough for the maximum 50-line cart, with a hard cap even for chunked requests.
    const bytes = await readBoundedBody(request, 128 * 1024);
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(source) as unknown;
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ code: "REQUEST_BODY_TOO_LARGE", error: "Request body exceeds the allowed size." }, { status: 413, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return Response.json({ code: "INVALID_JSON", error: "Request body must contain valid UTF-8 JSON." }, { status: 400, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
}
