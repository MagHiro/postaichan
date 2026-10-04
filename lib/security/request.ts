import { query } from "@/lib/db";
import { rateLimitKey, requestAddress } from "./http";
export { sameOrigin, readJsonBody } from "./http";

export function noStoreHeaders() {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
}

export function clientBucket(request: Request, scope: string) {
  const address = requestAddress(request);
  return address ? rateLimitKey(scope, address) : null;
}

export async function consumeIdentityRateLimit(scope: string, identity: string, limit: number, windowSeconds: number) {
  const result = await query<{ consume_rate_limit: boolean }>("select public.consume_rate_limit($1, $2, $3) as consume_rate_limit", [rateLimitKey(scope, identity), limit, windowSeconds]);
  return result.rows[0]?.consume_rate_limit === true;
}

export async function consumeRateLimit(request: Request, scope: string, limit: number, windowSeconds: number, extra = "") {
  const network = clientBucket(request, `${scope}:network`);
  // Lack of a trusted network address uses a generous shared safety limit. It
  // never puts every visitor into a small "unknown" bucket.
  const networkLimit = Math.max(limit * 10, 100);
  const networkAllowed = network
    ? await consumeIdentityRateLimit(`${scope}:network`, network, networkLimit, windowSeconds)
    : await consumeIdentityRateLimit(`${scope}:global`, "all", Math.max(limit * 100, 1000), windowSeconds);
  if (!networkAllowed) return false;
  if (!extra) return true;
  return consumeIdentityRateLimit(`${scope}:identity`, extra, limit, windowSeconds);
}
