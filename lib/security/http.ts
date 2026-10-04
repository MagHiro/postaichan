import { createHash } from "node:crypto";
import { isIP } from "node:net";

export function requestAddress(request: Request) {
  // Only enable behind an ingress that replaces these headers and blocks direct access.
  if (process.env.TRUST_PROXY_HEADERS !== "true") return "unknown";
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim();
  return address && isIP(address) ? address : "unknown";
}

export function rateLimitKey(scope: string, identity: string) {
  return `${scope}:${createHash("sha256").update(identity).digest("hex")}`;
}

export function sameOrigin(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (!origin) return true; // Non-browser clients have no ambient browser credentials.
  try {
    const supplied = new URL(origin);
    const expected = new URL(process.env.APP_ORIGIN || request.url);
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
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBoundedBody(request, 128 * 1024))) as unknown;
  } catch { return null; }
}
