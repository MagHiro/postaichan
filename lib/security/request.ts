import { createHash } from "node:crypto";
import { query } from "@/lib/db";

export function noStoreHeaders() {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

export function clientBucket(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return `${scope}:${createHash("sha256").update(address).digest("hex").slice(0, 32)}`;
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export async function consumeRateLimit(request: Request, scope: string, limit: number, windowSeconds: number, extra = "") {
  const bucket = `${clientBucket(request, scope)}:${extra}`;
  const result = await query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit($1, $2, $3) as consume_rate_limit", [bucket, limit, windowSeconds]);
  return result.rows[0]?.consume_rate_limit === true;
}
