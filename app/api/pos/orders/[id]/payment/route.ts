import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { MidtransProvider } from "@/lib/payments/midtrans";

export const runtime = "nodejs";

// Staff polling for cashier QRIS payments. Webhooks are the source of truth,
// so this reconciles with Midtrans when the row is still pending and the
// local expiry has passed (webhook delayed or missed), then reports state.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  const { id } = await params;
  try {
    const supabase = createAdminClient();
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, order_number, status, payments(id, method, provider, status, amount_idr, fee_idr, qr_string, expires_at, provider_order_id, settled_at)")
      .eq("id", id)
      .single();
    if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments;
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404 });

    let status = payment.status as string;
    // Reconcile once: if Midtrans says settled, persist it so the order
    // flips to paid even when the webhook never arrived.
    if (status === "pending" && payment.provider === "midtrans" && payment.provider_order_id) {
      try {
        const providerStatus = await new MidtransProvider().getPaymentStatus(payment.provider_order_id);
        if (providerStatus === "settled") {
          status = "settled";
          const now = new Date().toISOString();
          await supabase.from("payments").update({ status: "settled", last_provider_status: "settlement", settled_at: now }).eq("id", payment.id);
          await supabase.from("orders").update({ status: "paid" }).eq("id", order.id).in("status", ["awaiting_payment", "draft", "expired"]);
        } else if (providerStatus === "expired" || providerStatus === "failed") {
          status = providerStatus;
          await supabase.from("payments").update({ status, last_provider_status: providerStatus }).eq("id", payment.id);
        }
      } catch {
        // Provider unreachable — report the stored state; the client retries.
      }
    }

    return NextResponse.json({
      orderNumber: order.order_number,
      orderStatus: status === "settled" ? "paid" : order.status,
      paymentStatus: status,
      expiresAt: payment.expires_at,
      amountIdr: payment.amount_idr,
      // Returned so staff can re-display the pending QR from the drawer;
      // only valid while the payment is still pending.
      qrString: status === "pending" ? (payment.qr_string ?? null) : null,
    });
  } catch (error) {
    console.error("pos_payment_status_failed", error);
    return NextResponse.json({ error: "Payment status could not be checked." }, { status: 503 });
  }
}
