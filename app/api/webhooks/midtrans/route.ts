import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
    const supabase = createAdminClient();
    const { data: payment, error: paymentError } = await supabase.from("payments").select("id, order_id, amount_idr, method").eq("provider_order_id", event.order_id).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return NextResponse.json({ error: "Payment not found" }, { status: 404, headers: noStoreHeaders() });
    if (payment.method !== "qris" || Number(event.gross_amount) !== payment.amount_idr) return NextResponse.json({ error: "Payment amount mismatch" }, { status: 422, headers: noStoreHeaders() });
    if (event.payment_type && event.payment_type !== "qris") return NextResponse.json({ error: "Payment method mismatch" }, { status: 422, headers: noStoreHeaders() });
    const providerEventKey = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    const { error: eventError } = await supabase.from("payment_events").insert({ payment_id: payment.id, provider_event_key: providerEventKey, provider_transaction_id: event.transaction_id ?? null, event_type: event.transaction_status, payload: event, verified: true });
    if (eventError?.code === "23505") return NextResponse.json({ received: true, duplicate: true }, { headers: noStoreHeaders() });
    if (eventError) throw eventError;
    const nextStatus = paymentStatusFromProvider(event.transaction_status, event.fraud_status);
    const { error: transitionError } = await supabase.rpc("apply_payment_transition", { p_payment_id: payment.id, p_next_status: nextStatus, p_provider_status: event.transaction_status, p_provider_transaction_id: event.transaction_id ?? null, p_fee_idr: 0, p_settled_at: nextStatus === "settled" ? new Date().toISOString() : null });
    if (transitionError) throw transitionError;
    return NextResponse.json({ received: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("midtrans_webhook_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 503, headers: noStoreHeaders() });
  }
}
