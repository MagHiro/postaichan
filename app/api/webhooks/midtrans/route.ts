import { NextResponse } from "next/server";
import { databaseErrorCode, query } from "@/lib/db";
import { midtransWebhookSchema } from "@/lib/schemas";
import { paymentStatusFromProvider } from "@/lib/domain/payment-state";
import { readJsonBody, noStoreHeaders } from "@/lib/security/request";
import { midtransEventIdentity, parseMidtransIdrAmount, parseMidtransTimestamp, verifyMidtransSignature } from "@/lib/payments/midtrans-webhook";
import { getServerConfig } from "@/lib/config";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = createRequestId();
  const serverKey = getServerConfig().midtransServerKey;
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = midtransWebhookSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification" }, { status: 400, headers: noStoreHeaders() });
  const event = parsed.data;
  if (!verifyMidtransSignature(event, serverKey)) return NextResponse.json({ error: "Invalid signature" }, { status: 401, headers: noStoreHeaders() });
  try {
    const paymentResult = await query<{ id: string; order_id: string; amount_idr: number; method: string }>("select id, order_id, amount_idr, method from public.payments where provider_order_id = $1 limit 1", [event.order_id]);
    const payment = paymentResult.rows[0];
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404, headers: noStoreHeaders() });
    const amountIdr = parseMidtransIdrAmount(event.gross_amount);
    if (payment.method !== "qris" || amountIdr === null || amountIdr !== payment.amount_idr) return NextResponse.json({ error: "Payment amount mismatch" }, { status: 422, headers: noStoreHeaders() });
    if (event.payment_type && event.payment_type !== "qris") return NextResponse.json({ error: "Payment method mismatch" }, { status: 422, headers: noStoreHeaders() });
    const providerEventKey = midtransEventIdentity(event);
    let duplicate = false;
    try {
      await query("insert into public.payment_events(payment_id, provider_event_key, provider_transaction_id, event_type, payload, verified) values ($1, $2, $3, $4, $5::jsonb, true)", [payment.id, providerEventKey, event.transaction_id ?? null, event.transaction_status, event]);
    } catch (error) {
      duplicate = databaseErrorCode(error) === "23505";
      if (!duplicate) throw error;
    }
    if (event.transaction_status === "refund" || event.transaction_status === "partial_refund") {
      const payload = event as Record<string, unknown>;
      const refundItems = Array.isArray(payload.refunds) ? payload.refunds : [];
      const refundKeys = refundItems.flatMap((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).refund_key === "string" ? [(item as Record<string, string>).refund_key] : []);
      if (typeof payload.refund_key === "string") refundKeys.push(payload.refund_key);
      await query("select public.mark_provider_refund_notification($1::uuid, $2, $3::jsonb)", [payment.id, event.transaction_status, JSON.stringify({ refundKeys, refundAmount: typeof payload.refund_amount === "string" ? payload.refund_amount : null })]);
      return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) }, { headers: noStoreHeaders() });
    }
    const actionable = ["pending", "settlement", "capture", "expire", "cancel", "deny", "failure"].includes(event.transaction_status);
    if (!actionable) return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}), ignored: true }, { headers: noStoreHeaders() });
    const nextStatus = paymentStatusFromProvider(event.transaction_status, event.fraud_status);
    // Midtrans timestamps are WIB when they omit an offset. Use receipt time only
    // when its settlement_time is absent or malformed.
    const settlementAt = nextStatus === "settled"
      ? (parseMidtransTimestamp(event.settlement_time) ?? parseMidtransTimestamp(event.transaction_time) ?? new Date())
      : null;
    await query("select * from public.apply_payment_transition($1::uuid, $2::public.payment_status, $3, $4, $5, $6::timestamptz)", [payment.id, nextStatus, event.transaction_status, event.transaction_id ?? null, 0, settlementAt?.toISOString() ?? null]);
    structuredLog("info", "midtrans_webhook_processed", requestId, { paymentId: payment.id, providerStatus: event.transaction_status, duplicate });
    return NextResponse.json({ received: true, ...(duplicate ? { duplicate: true } : {}) }, { headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "midtrans_webhook_failed", requestId, { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 503, headers: noStoreHeaders() });
  }
}
