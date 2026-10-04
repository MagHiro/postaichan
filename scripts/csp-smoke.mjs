import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import pg from "pg";
import QRCode from "qrcode";

const host = "127.0.0.1";
const port = Number(process.env.CSP_SMOKE_PORT ?? 3010);
const baseUrl = `http://${host}:${port}`;
const connectionString = process.env.DATABASE_TEST_URL;
assert.ok(connectionString, "DATABASE_TEST_URL is required for the production CSP smoke test");

const runtime = new pg.Client({ connectionString });
await runtime.connect();
let cookieToken = "";
let cookieHash = "";
let server;
try {
  const admin = await runtime.query("select id from public.profiles where role='admin' and active=true order by created_at limit 1");
  assert.ok(admin.rows[0]?.id, "An active seeded administrator is required for authenticated page rendering");
  cookieToken = randomBytes(32).toString("base64url");
  cookieHash = createHash("sha256").update(cookieToken).digest("hex");
  await runtime.query("select public.create_staff_session($1::uuid,$2,timezone('utc',now())+interval '1 hour')", [admin.rows[0].id, cookieHash]);

  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", host, "--port", String(port)], {
    env: process.env,
    stdio: "ignore",
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Production server exited before readiness.");
    try {
      const response = await fetch(`${baseUrl}/api/health/live`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) { ready = true; break; }
    } catch { /* The process is still starting. */ }
    await delay(500);
  }
  assert.equal(ready, true, "Production server did not become ready");
  const health = await fetch(`${baseUrl}/api/health/ready`);
  assert.equal(health.status, 200, "Readiness must pass against the isolated PostgreSQL test DB");

  const paths = ["/", "/login", "/pos", "/admin/reconciliation"];
  let checkedScript = false;
  for (const path of paths) {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: path === "/" || path === "/login" ? {} : { cookie: `baranburn_staff_session=${cookieToken}` },
      redirect: "manual",
    });
    assert.equal(response.status, 200, `${path} should render with the test staff session`);
    const policy = response.headers.get("content-security-policy") ?? "";
    assert.match(policy, /default-src 'self'/, `${path} must include the production CSP`);
    assert.match(policy, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/, `${path} must use a nonce-bound script policy`);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /img-src 'self' data: blob: https:\/\/api\.midtrans\.com https:\/\/api\.sandbox\.midtrans\.com/);
    assert.match(policy, /upgrade-insecure-requests/);
    assert.match(response.headers.get("strict-transport-security") ?? "", /max-age=31536000/);

    const html = await response.text();
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
    assert.ok(nonce);
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1] ?? "");
    assert.ok(scripts.length > 0, `${path} should render Next hydration scripts`);
    for (const attributes of scripts) {
      if (!/\bsrc=/.test(attributes)) {
        assert.ok(
          attributes.includes(`nonce="${nonce}"`) || attributes.includes(`nonce='${nonce}'`),
          `${path} inline scripts must carry the response nonce`,
        );
      }
    }
    const chunkPath = scripts.map((attributes) => /\bsrc=["']([^"']+)/.exec(attributes)?.[1]).find((value) => value?.startsWith("/_next/static/"));
    if (chunkPath) {
      const chunk = await fetch(new URL(chunkPath, baseUrl));
      assert.equal(chunk.status, 200, `${path} hydration chunks should be available`);
      checkedScript = true;
    }
  }
  assert.equal(checkedScript, true, "At least one same-origin hydration chunk must load");
  const qrImage = await QRCode.toDataURL("https://postaichan.example/order/g/opaque-test-token", { width: 180, margin: 2 });
  assert.match(qrImage, /^data:image\/png;base64,/);
  console.log("Production CSP smoke passed: public, login, POS, admin, hydration assets, QR rendering, and readiness.");
} finally {
  if (cookieHash) await runtime.query("update public.staff_sessions set revoked_at=coalesce(revoked_at,timezone('utc',now())) where token_hash=$1", [cookieHash]).catch(() => undefined);
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await Promise.race([new Promise((resolve) => server.once("exit", resolve)), delay(5000)]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await runtime.end();
}
