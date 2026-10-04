import { query } from "@/lib/db";
import { rateLimitKey, requestAddress } from "./http";
export { sameOrigin, readJsonBody } from "./http";

export function noStoreHeaders() {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

export function clientBucket(request: Request, scope: string) {
  return rateLimitKey(scope, requestAddress(request));
}

export async function consumeIdentityRateLimit(scope: string, identity: string, limit: number, windowSeconds: number) {
  const result = await query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit($1, $2, $3) as consume_rate_limit", [rateLimitKey(scope, identity), limit, windowSeconds]);
  return result.rows[0]?.consume_rate_limit === true;
}

export async function consumeRateLimit(request: Request, scope: string, limit: number, windowSeconds: number, extra = "") {
  // An authenticated identity is limited independently of its network address.
  return consumeIdentityRateLimit(scope, extra || requestAddress(request), limit, windowSeconds);
}
