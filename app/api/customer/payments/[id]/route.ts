import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { uuidParamSchema } from "@/lib/schemas";
import { consumeRateLimit, noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-order-access-token");
  const { id } = await params;
  if (!token) return NextResponse.json({ error: "Order access token required." }, { status: 401, headers: noStoreHeaders() });
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const sessionHash = hashOpaqueToken(token);
    if (!(await consumeRateLimit(request, "payment-status", 30, 300, sessionHash.slice(0, 24)))) return NextResponse.json({ error: "Polling terlalu sering." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } });
    const supabase = createAdminClient();
    const { data: session } = await supabase.from("customer_sessions").select("id").eq("access_token_hash", sessionHash).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!session) return NextResponse.json({ error: "Order session expired." }, { status: 401, headers: noStoreHeaders() });
    const { data: order, error: orderError } = await supabase.from("orders").select("id, order_number, status").eq("id", id).eq("customer_session_id", session.id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const { data: payment, error: paymentError } = await supabase.from("payments").select("id, provider, status, expires_at, amount_idr, provider_order_id, qr_string").eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (paymentError) throw paymentError;
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404, headers: noStoreHeaders() });
    let paymentStatus = payment.status as string;
    let orderStatus = order.status as string;
    if (paymentStatus === "pending" && payment.provider === "midtrans" && payment.provider_order_id) {
      try {
        const providerStatus = await new MidtransProvider().getPaymentStatus(payment.provider_order_id);
        const transition = providerStatus === "settled" ? "settled" : providerStatus === "expired" ? "expired" : providerStatus === "failed" ? "failed" : "pending";
        const { data: transitionData, error } = await supabase.rpc("apply_payment_transition", { p_payment_id: payment.id, p_next_status: transition, p_provider_status: providerStatus, p_provider_transaction_id: null, p_fee_idr: 0, p_settled_at: transition === "settled" ? new Date().toISOString() : null });
        if (error) throw error;
        const transitionRow = Array.isArray(transitionData) ? transitionData[0] : transitionData;
        paymentStatus = transitionRow?.payment_status ?? paymentStatus;
        orderStatus = transitionRow?.order_status ?? orderStatus;
      } catch {
        // Provider outages do not become fake failures. Stored state remains authoritative.
      }
    }
    const qr = presentQrMaterial(paymentStatus === "pending" ? payment.qr_string : null);
    return NextResponse.json({ orderNumber: order.order_number, orderStatus, paymentStatus, expiresAt: payment.expires_at, amountIdr: payment.amount_idr, ...qr }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("customer_payment_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "We couldn't check payment yet." }, { status: 503, headers: noStoreHeaders() });
  }
}
