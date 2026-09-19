import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { uuidParamSchema } from "@/lib/schemas";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

async function paymentStatus(request: Request, { params }: Context, synchronizeProvider: boolean) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const { data: order, error: orderError } = await supabase.from("orders").select("id, order_number, status, payments(id, method, provider, status, amount_idr, qr_string, expires_at, provider_order_id, settled_at, created_at)").eq("id", id).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const payments = Array.isArray(order.payments) ? order.payments : order.payments ? [order.payments] : [];
    const payment = payments.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0];
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404, headers: noStoreHeaders() });
    let status = payment.status as string;
    if (synchronizeProvider && status === "pending" && payment.provider === "midtrans" && payment.provider_order_id) {
      try {
        const providerStatus = await new MidtransProvider().getPaymentStatus(payment.provider_order_id);
        const next = providerStatus === "settled" ? "settled" : providerStatus === "expired" ? "expired" : providerStatus === "failed" ? "failed" : "pending";
        const { data: transitionData, error } = await supabase.rpc("apply_payment_transition", { p_payment_id: payment.id, p_next_status: next, p_provider_status: providerStatus, p_provider_transaction_id: null, p_fee_idr: 0, p_settled_at: next === "settled" ? new Date().toISOString() : null });
        if (error) throw error;
        const transitionRow = Array.isArray(transitionData) ? transitionData[0] : transitionData;
        status = transitionRow?.payment_status ?? status;
      } catch {
        // Keep the stored state during provider outages.
      }
    }
    return NextResponse.json({ orderNumber: order.order_number, orderStatus: status === "settled" ? "paid" : order.status, paymentStatus: status, expiresAt: payment.expires_at, amountIdr: payment.amount_idr, ...presentQrMaterial(status === "pending" ? payment.qr_string : null) }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_payment_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Payment status could not be checked." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function GET(request: Request, context: Context) {
  return paymentStatus(request, context, false);
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  return paymentStatus(request, context, true);
}
