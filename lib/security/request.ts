import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

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
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("consume_rate_limit", { p_bucket_key: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) throw error;
  return data === true;
}
