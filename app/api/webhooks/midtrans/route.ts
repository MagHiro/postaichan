import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { databaseErrorCode, query } from "@/lib/db";
import { midtransWebhookSchema } from "@/lib/schemas";
import { paymentStatusFromProvider } from "@/lib/domain/payment-state";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) return NextResponse.json({ error: "Webhook is not configured." }, { status: 503, headers: noStoreHeaders() });
  const body = await request.json().catch(() => null);
  const parsed = midtransWebhookSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification" }, { status: 400, headers: noStoreHeaders() });
  const event = parsed.data;
  const expected = createHash("sha512").update(`${event.order_id}${event.status_code}${event.gross_amount}${serverKey}`).digest("hex");
  if (!safeEqual(event.signature_key, expected)) return NextResponse.json({ error: "Invalid signature" }, { status: 401, headers: noStoreHeaders() });
  try {
    const paymentResult = await query<{ id: string; order_id: string; amount_idr: number; method: string }>("select id, order_id, amount_idr, method from public.payments where provider_order_id = $1 limit 1", [event.order_id]);
    const payment = paymentResult.rows[0];
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404, headers: noStoreHeaders() });
    if (payment.method !== "qris" || Number(event.gross_amount) !== payment.amount_idr) return NextResponse.json({ error: "Payment amount mismatch" }, { status: 422, headers: noStoreHeaders() });
    if (event.payment_type && event.payment_type !== "qris") return NextResponse.json({ error: "Payment method mismatch" }, { status: 422, headers: noStoreHeaders() });
    const providerEventKey = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    let duplicate = false;
    try {
      await query("insert into public.payment_events(payment_id, provider_event_key, provider_transaction_id, event_type, payload, verified) values ($1, $2, $3, $4, $5::jsonb, true)", [payment.id, providerEventKey, event.transaction_id ?? null, event.transaction_status, event]);
    } catch (error) {
      duplicate = databaseErrorCode(error) === "23505";
      if (!duplicate) throw error;
    }
    const nextStatus = paymentStatusFromProvider(event.transaction_status, event.fraud_status);
    await query("select * from public.apply_payment_transition($1::uuid, $2::public.payment_status, $3, $4, $5, $6::timestamptz)", [payment.id, nextStatus, event.transaction_status, event.transaction_id ?? null, 0, nextStatus === "settled" ? new Date().toISOString() : null]);
    return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("midtrans_webhook_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 503, headers: noStoreHeaders() });
  }
}
