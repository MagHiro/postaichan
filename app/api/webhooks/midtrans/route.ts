import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { midtransWebhookSchema } from "@/lib/schemas";

export const runtime = "nodejs";

function expectedSignature(orderId: string, statusCode: string, grossAmount: string) { return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${process.env.MIDTRANS_SERVER_KEY ?? ""}`).digest("hex"); }
function safeEqual(left: string, right: string) { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }

export async function POST(request: Request) {
  const parsed = midtransWebhookSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid notification" }, { status: 400 });
  const event = parsed.data;
  if (!safeEqual(event.signature_key, expectedSignature(event.order_id, event.status_code, event.gross_amount))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  try {
    const supabase = createAdminClient();
    const { data: payment } = await supabase.from("payments").select("id, order_id, amount_idr").eq("provider_order_id", event.order_id).single();
    if (!payment || Number(event.gross_amount) !== payment.amount_idr) return NextResponse.json({ error: "Payment amount mismatch" }, { status: 422 });

    const providerEventKey = `${event.order_id}:${event.transaction_id ?? event.transaction_status}:${event.status_code}`;
    const { error: eventError } = await supabase.from("payment_events").insert({ payment_id: payment.id, provider_event_key: providerEventKey, provider_transaction_id: event.transaction_id, event_type: event.transaction_status, payload: event, verified: true });
    if (eventError?.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    if (eventError) throw eventError;

    const settled = ["settlement", "capture"].includes(event.transaction_status) && (!event.fraud_status || event.fraud_status === "accept");
    const nextPaymentStatus = settled ? "settled" : ["expire", "cancel"].includes(event.transaction_status) ? "expired" : ["deny", "failure"].includes(event.transaction_status) ? "failed" : "pending";
    await supabase.from("payments").update({ status: nextPaymentStatus, last_provider_status: event.transaction_status, settled_at: settled ? new Date().toISOString() : null }).eq("id", payment.id);
    if (settled) await supabase.from("orders").update({ status: "paid" }).eq("id", payment.order_id).in("status", ["awaiting_payment", "draft", "expired"]);
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("midtrans_webhook_failed", error);
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 503 });
  }
}
