const DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:55432/baranburn";

function invalid(name) {
  throw new Error(`Invalid server configuration: ${name}`);
}

function parseOrigin(value, production) {
  let parsed;
  try { parsed = new URL(value); } catch { invalid("APP_ORIGIN must be an absolute HTTP(S) origin"); }
  if (!parsed || !["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) invalid("APP_ORIGIN must contain only an HTTP(S) origin");
  if (production && parsed.protocol !== "https:") invalid("APP_ORIGIN must use HTTPS in production");
  return parsed.origin;
}

export function getServerConfig(env = process.env, nodeEnv = env.NODE_ENV ?? "development") {
  const production = nodeEnv === "production";
  const localDefaults = nodeEnv === "development" || nodeEnv === "test";
  if (env.ALLOW_DEV_STAFF_BYPASS === "true" && nodeEnv !== "development") invalid("ALLOW_DEV_STAFF_BYPASS is development-only");

  const databaseUrl = env.DATABASE_URL ?? (localDefaults ? DEFAULT_DATABASE_URL : "");
  if (!databaseUrl) invalid("DATABASE_URL is required");
  let database;
  try { database = new URL(databaseUrl); } catch { invalid("DATABASE_URL must be a PostgreSQL URL"); }
  if (!database || !["postgres:", "postgresql:"].includes(database.protocol)) invalid("DATABASE_URL must be a PostgreSQL URL");
  if (production && (decodeURIComponent(database.username).toLowerCase() === "postgres" || decodeURIComponent(database.password) === "postgres")) invalid("DATABASE_URL must not use the local development database credentials in production; use a dedicated least-privileged runtime login");

  const appOrigin = parseOrigin(env.APP_ORIGIN ?? (localDefaults ? "http://localhost:3000" : ""), production);
  const midtransKey = env.MIDTRANS_SERVER_KEY ?? (localDefaults ? "server_only_midtrans_server_key" : "");
  if (!midtransKey.trim()) invalid("MIDTRANS_SERVER_KEY is required");
  const midtransProductionValue = env.MIDTRANS_IS_PRODUCTION ?? (localDefaults ? "false" : "");
  if (!["true", "false"].includes(midtransProductionValue)) invalid("MIDTRANS_IS_PRODUCTION must be explicitly true or false");

  const poolValue = env.DATABASE_POOL_MAX ?? (localDefaults ? "10" : "");
  if (!/^\d+$/.test(poolValue)) invalid("DATABASE_POOL_MAX must be a positive integer no greater than 40");
  const poolMax = Number(poolValue);
  if (!Number.isSafeInteger(poolMax) || poolMax < 1 || poolMax > 40) invalid("DATABASE_POOL_MAX must be a positive integer no greater than 40");

  const clientIpStrategy = env.CLIENT_IP_STRATEGY ?? (localDefaults ? "none" : "");
  if (!["none", "trusted_header", "trusted_proxy"].includes(clientIpStrategy)) invalid("CLIENT_IP_STRATEGY must be none, trusted_header, or trusted_proxy");
  const trustedClientIpHeader = (env.TRUSTED_CLIENT_IP_HEADER ?? "").toLowerCase();
  if (clientIpStrategy === "trusted_header" && !/^[a-z0-9-]{1,80}$/.test(trustedClientIpHeader)) invalid("TRUSTED_CLIENT_IP_HEADER is required for trusted_header strategy");
  if (clientIpStrategy === "trusted_header" && ["x-forwarded-for", "forwarded"].includes(trustedClientIpHeader)) invalid("TRUSTED_CLIENT_IP_HEADER must be a single-address header overwritten by the ingress");
  const proxyHopsValue = env.TRUSTED_PROXY_HOPS ?? "";
  const proxyHops = clientIpStrategy === "trusted_proxy" ? Number(proxyHopsValue) : 0;
  if (clientIpStrategy === "trusted_proxy" && (!/^\d+$/.test(proxyHopsValue) || !Number.isSafeInteger(proxyHops) || proxyHops < 1 || proxyHops > 10)) invalid("TRUSTED_PROXY_HOPS must be between 1 and 10");

  const requireOrderingQrValue = env.REQUIRE_ORDERING_QR ?? (localDefaults ? "false" : "");
  if (!["true", "false"].includes(requireOrderingQrValue)) invalid("REQUIRE_ORDERING_QR must be explicitly true or false");

  return Object.freeze({
    databaseUrl,
    databasePoolMax: poolMax,
    appOrigin,
    midtransServerKey: midtransKey,
    midtransIsProduction: midtransProductionValue === "true",
    clientIpStrategy,
    trustedClientIpHeader,
    trustedProxyHops: proxyHops,
    requireOrderingQr: requireOrderingQrValue === "true",
    isProduction: production,
    allowDevStaffBypass: nodeEnv === "development" && env.ALLOW_DEV_STAFF_BYPASS === "true",
  });
}

export function getMigrationDatabaseUrl(env = process.env, nodeEnv = env.NODE_ENV ?? "development") {
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    if (!env.DATABASE_ADMIN_URL) invalid("DATABASE_ADMIN_URL is required for migrations and seed tasks outside development/test");
    return env.DATABASE_ADMIN_URL;
  }
  return env.DATABASE_ADMIN_URL ?? env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}
