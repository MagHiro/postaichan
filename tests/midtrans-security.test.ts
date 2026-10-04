import test from "node:test";
import assert from "node:assert/strict";
import { midtransWebhookSchema } from "../lib/schemas.ts";
import { canonicalJson, midtransEventIdentity, midtransSignature, parseMidtransIdrAmount, parseMidtransTimestamp, verifyMidtransSignature } from "../lib/payments/midtrans-webhook.ts";
import { midtransExpiry } from "../lib/payments/midtrans-expiry.ts";
import { MidtransClient } from "../lib/payments/midtrans-client.ts";
import { providerStateBeforeCancellation } from "../lib/payments/provider-cancellation.ts";

test("a realistic signed Midtrans QRIS settlement keeps exact signed strings and provider fields", () => {
  const serverKey = "unit-test-server-key";
  const event = {
    transaction_time: "2026-10-04 10:20:30",
    transaction_status: "settlement",
    transaction_id: "midtrans-transaction-837261",
    status_message: "midtrans payment notification",
    status_code: "200",
    signature_key: "",
    payment_type: "qris",
    order_id: "TT-261004-0001-9c12ab34cd56ef78",
    gross_amount: "30000.00",
    currency: "IDR",
    settlement_time: "2026-10-04 10:20:42",
    acquirer: "gopay",
    issuer: "gopay",
    fraud_status: "accept",
    custom_provider_metadata: { attempt: 2, source: "notification" },
  };
  event.signature_key = midtransSignature(event.order_id, event.status_code, event.gross_amount, serverKey);
  const parsed = midtransWebhookSchema.safeParse(event);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.gross_amount, "30000.00");
  assert.equal(parsed.data.order_id, event.order_id);
  assert.equal(parsed.data.custom_provider_metadata, event.custom_provider_metadata);
  assert.equal(verifyMidtransSignature(parsed.data, serverKey), true);
  assert.equal(parseMidtransIdrAmount(parsed.data.gross_amount), 30_000);
  assert.equal(parseMidtransTimestamp(parsed.data.settlement_time)?.toISOString(), "2026-10-04T03:20:42.000Z");
  assert.equal(verifyMidtransSignature({ ...parsed.data, gross_amount: "30000.0" }, serverKey), false);
});

test("Midtrans IDR amounts accept only safe integer values with an optional zero fraction", () => {
  assert.equal(parseMidtransIdrAmount("30000"), 30_000);
  assert.equal(parseMidtransIdrAmount("30000.00"), 30_000);
  for (const invalid of ["30000.01", "-1", "+1", " 30000", "30000 ", "3e4", "NaN", "Infinity", "", "01", "1.0", "1.000", "9007199254740992", "999999999999999999999999"]) {
    assert.equal(parseMidtransIdrAmount(invalid), null, invalid);
  }
});

test("canonical event identity ignores recursive object-key order", () => {
  const first = { order_id: "order-1", transaction_status: "settlement", transaction_id: "txn-1", extras: { z: 1, nested: { b: 2, a: 3 } } };
  const retry = { extras: { nested: { a: 3, b: 2 }, z: 1 }, transaction_id: "txn-1", transaction_status: "settlement", order_id: "order-1" };
  assert.equal(canonicalJson(first), canonicalJson(retry));
  assert.equal(midtransEventIdentity(first), midtransEventIdentity(retry));
  assert.notEqual(midtransEventIdentity(first), midtransEventIdentity({ ...retry, transaction_status: "refund" }));
});

test("verified Midtrans states outside QRIS actions can be acknowledged without schema rejection", () => {
  const payload = { order_id: "order-1", status_code: "200", gross_amount: "1.00", signature_key: "a".repeat(128), transaction_status: "future_provider_state", payment_type: "qris" };
  assert.equal(midtransWebhookSchema.safeParse(payload).success, true);
});

test("delayed provider creation keeps expiry tied to the database payment window", async () => {
  const createdAt = new Date("2026-10-04T03:00:00.500Z");
  const expiresAt = new Date("2026-10-04T03:15:00.500Z");
  const input = { providerOrderId: "TT-261004-1", amountIdr: 30_000, createdAt, expiresAt };
  const first = midtransExpiry(input, createdAt.getTime());
  await new Promise((resolve) => setTimeout(resolve, 150));
  const afterOutboundDelay = midtransExpiry(input, createdAt.getTime() + 150_000);
  assert.deepEqual(afterOutboundDelay, first);
  assert.deepEqual(first, { order_time: "2026-10-04 10:00:00 +0700", expiry_duration: 900, unit: "second" });
  assert.equal(midtransExpiry(input, expiresAt.getTime() - 10_000), null);
});

test("provider creation sends DB-anchored seconds even when its outbound call is delayed", async () => {
  const originalFetch = globalThis.fetch;
  const createdAt = new Date(Date.now() - 5_000);
  const expiresAt = new Date(createdAt.getTime() + 15 * 60_000);
  const sent: { body: Record<string, unknown> | null } = { body: null };
  globalThis.fetch = async (_input, init) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    sent.body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ status_code: "201", transaction_id: "txn-1", qr_string: "000201qris" });
  };
  try {
    const expected = midtransExpiry({ providerOrderId: "TT-261004-2", amountIdr: 30_000, createdAt, expiresAt });
    const client = new MidtransClient({ serverKey: "test-key", baseUrl: "https://sandbox.example" });
    const created = await client.createPayment({ providerOrderId: "TT-261004-2", amountIdr: 30_000, createdAt, expiresAt });
    assert.deepEqual(sent.body?.custom_expiry, expected);
    assert.equal((sent.body?.custom_expiry as { unit: string }).unit, "second");
    assert.equal(created.providerExpiresAt?.toISOString(), new Date(Date.parse(expected!.order_time.replace(" ", "T").replace(" +0700", "+07:00")) + 900_000).toISOString());
  } finally { globalThis.fetch = originalFetch; }
});

test("an ambiguous 412 expire response is reconciled through provider status", async () => {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); paths.push(url);
    return url.endsWith("/expire")
      ? Response.json({ status_code: "412", status_message: "cannot expire" }, { status: 412 })
      : Response.json({ transaction_status: "settlement", transaction_id: "txn-settled", settlement_time: "2026-10-04 10:21:00" });
  };
  try {
    const client = new MidtransClient({ serverKey: "test-key", baseUrl: "https://sandbox.example" });
    const state = await providerStateBeforeCancellation(client, "TT-261004-3");
    assert.equal(state.state, "settled");
    assert.equal(state.providerTransactionId, "txn-settled");
    assert.deepEqual(paths.map((path) => path.endsWith("/expire") ? "expire" : "status"), ["expire", "status"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("a 404 expiry can proceed only after status confirms expiry", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).endsWith("/expire")
    ? Response.json({ status_code: "404" }, { status: 404 })
    : Response.json({ transaction_status: "expire", transaction_id: "txn-expired" });
  try {
    const client = new MidtransClient({ serverKey: "test-key", baseUrl: "https://sandbox.example" });
    const state = await providerStateBeforeCancellation(client, "TT-261004-4");
    assert.equal(state.state, "expired");
    assert.equal(state.providerStatus, "expire");
  } finally { globalThis.fetch = originalFetch; }
});

test("provider duplicate refund responses remain a reconciliation signal", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (input) => {
    requestedUrl = String(input);
    return Response.json({ status_message: "duplicate refund_key" }, { status: 409 });
  };
  try {
    const client = new MidtransClient({ serverKey: "test-key", baseUrl: "https://sandbox.example" });
    assert.deepEqual(await client.refundPayment("txn-midtrans-261004-5", 15_000, "refund-stable-key"), { submitted: false, duplicate: true });
    assert.equal(requestedUrl, "https://sandbox.example/v2/txn-midtrans-261004-5/refund");
  } finally { globalThis.fetch = originalFetch; }
});
