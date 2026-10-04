import test from "node:test";
import assert from "node:assert/strict";
import { getMigrationDatabaseUrl, getServerConfig } from "../lib/config-values.mjs";
import { rateLimitKey, requestAddress } from "../lib/security/http.ts";
import { canStartCustomerSession, publicTableDirectory } from "../lib/security/public-ordering.ts";

test("production configuration requires explicit safe database, origin, provider and proxy settings", () => {
  const base = {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app_user:separate-secret@db.example/postaichan",
    DATABASE_POOL_MAX: "8",
    APP_ORIGIN: "https://postaichan.example",
    MIDTRANS_SERVER_KEY: "never-print-this",
    MIDTRANS_IS_PRODUCTION: "true",
    CLIENT_IP_STRATEGY: "trusted_header",
    TRUSTED_CLIENT_IP_HEADER: "x-ingress-client-ip",
    REQUIRE_ORDERING_QR: "true",
  } as NodeJS.ProcessEnv;
  assert.equal(getServerConfig(base, "production").requireOrderingQr, true);
  for (const changes of [
    { DATABASE_URL: undefined },
    { DATABASE_POOL_MAX: "0" },
    { APP_ORIGIN: "http://postaichan.example" },
    { MIDTRANS_IS_PRODUCTION: undefined },
    { CLIENT_IP_STRATEGY: undefined },
    { REQUIRE_ORDERING_QR: undefined },
    { DATABASE_URL: "postgresql://postgres:postgres@db.example/postaichan" },
    { ALLOW_DEV_STAFF_BYPASS: "true" },
  ]) {
    assert.throws(() => getServerConfig({ ...base, ...changes }, "production"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes("never-print-this"), false);
      assert.equal(error.message.includes("separate-secret"), false);
      return true;
    });
  }
  assert.throws(
    () => getServerConfig({ ...base, DATABASE_URL: "postgresql://postgres:postgres@db.example/postaichan" }, "production"),
    (error: unknown) => error instanceof Error
      && error.message.includes("local development database credentials")
      && !error.message.includes("postgres")
      && !error.message.includes("never-print-this"),
  );
});

test("both public-ordering policies are deliberate and QR-required listings hide internal table UUIDs", () => {
  assert.equal(canStartCustomerSession(false), true);
  assert.equal(canStartCustomerSession(false, undefined, undefined), true);
  assert.equal(canStartCustomerSession(true), false);
  assert.equal(canStartCustomerSession(true, "opaque-table-token"), true);
  assert.equal(canStartCustomerSession(true, undefined, "opaque-general-token"), true);
  const rows = [{ id: "internal-uuid", label: "Table 01" }];
  assert.deepEqual(publicTableDirectory(rows, false), rows);
  assert.deepEqual(publicTableDirectory(rows, true), [{ label: "Table 01" }]);
});

test("production migrations and seeds use the single DATABASE_URL", () => {
  assert.equal(
    getMigrationDatabaseUrl({ NODE_ENV: "production", DATABASE_URL: "postgresql://app:secret@db.example/app" }, "production"),
    "postgresql://app:secret@db.example/app",
  );
  assert.throws(() => getMigrationDatabaseUrl({ NODE_ENV: "production", DATABASE_ADMIN_URL: "postgresql://migrator:secret@db/app" }, "production"), /DATABASE_URL/);
  assert.throws(() => getMigrationDatabaseUrl({ NODE_ENV: "staging", DATABASE_URL: undefined }, "staging"), /DATABASE_URL/);
  assert.throws(() => getServerConfig({ NODE_ENV: "staging" }, "staging"), /DATABASE_URL/);
});

test("Neon migration URL switches pooled host to direct host without changing credentials or options", () => {
  const direct = getMigrationDatabaseUrl({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://app:secret@ep-example-pooler.c-4.ap-southeast-1.aws.neon.tech/db?sslmode=require&channel_binding=require",
  }, "production");
  const parsed = new URL(direct);
  assert.equal(parsed.hostname, "ep-example.c-4.ap-southeast-1.aws.neon.tech");
  assert.equal(parsed.username, "app");
  assert.equal(parsed.password, "secret");
  assert.equal(parsed.searchParams.get("sslmode"), "require");
  assert.equal(parsed.searchParams.get("channel_binding"), "require");
});

test("trusted client-IP strategies ignore spoofable headers and select the configured proxy hop", () => {
  const originalStrategy = process.env.CLIENT_IP_STRATEGY;
  const originalHeader = process.env.TRUSTED_CLIENT_IP_HEADER;
  const originalHops = process.env.TRUSTED_PROXY_HOPS;
  try {
    process.env.CLIENT_IP_STRATEGY = "trusted_header";
    process.env.TRUSTED_CLIENT_IP_HEADER = "x-ingress-client-ip";
    assert.equal(requestAddress(new Request("https://app.example", { headers: { "x-forwarded-for": "203.0.113.9" } })), null);
    assert.equal(requestAddress(new Request("https://app.example")), null);
    assert.equal(requestAddress(new Request("https://app.example", { headers: { "x-ingress-client-ip": "198.51.100.7" } })), "198.51.100.7");
    process.env.CLIENT_IP_STRATEGY = "trusted_proxy";
    process.env.TRUSTED_PROXY_HOPS = "2";
    assert.equal(requestAddress(new Request("https://app.example", { headers: { "x-forwarded-for": "203.0.113.99, 198.51.100.7, 10.0.0.2" } })), "198.51.100.7");
    assert.equal(requestAddress(new Request("https://app.example", { headers: { "x-forwarded-for": "bad, 10.0.0.2" } })), null);

    const sharedAddress = "198.51.100.7";
    assert.equal(rateLimitKey("checkout:network", sharedAddress), rateLimitKey("checkout:network", sharedAddress));
    assert.notEqual(rateLimitKey("checkout:identity", "session-a"), rateLimitKey("checkout:identity", "session-b"));
    assert.notEqual(rateLimitKey("staff-login-account", "one@example.test"), rateLimitKey("staff-login-account", "two@example.test"));
  } finally {
    if (originalStrategy === undefined) delete process.env.CLIENT_IP_STRATEGY; else process.env.CLIENT_IP_STRATEGY = originalStrategy;
    if (originalHeader === undefined) delete process.env.TRUSTED_CLIENT_IP_HEADER; else process.env.TRUSTED_CLIENT_IP_HEADER = originalHeader;
    if (originalHops === undefined) delete process.env.TRUSTED_PROXY_HOPS; else process.env.TRUSTED_PROXY_HOPS = originalHops;
  }
});
