import { NextResponse } from "next/server";
import { query } from "@/lib/db";
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
    const orderResult = await query<{ id: string; order_number: string; order_status: string; payment_id: string; method: string; provider: string; payment_status: string; amount_idr: number; qr_string: string | null; expires_at: string | null; provider_order_id: string; settled_at: string | null; payment_created_at: string }>(
      `select o.id, o.order_number, o.status as order_status, p.id as payment_id, p.method, p.provider, p.status as payment_status, p.amount_idr, p.qr_string, p.expires_at, p.provider_order_id, p.settled_at, p.created_at as payment_created_at
       from public.orders o left join public.payments p on p.order_id = o.id
       where o.id = $1 order by p.created_at desc`,
      [id],
    );
    const order = orderResult.rows[0];
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const payment = orderResult.rows.find((row) => row.payment_id);
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404, headers: noStoreHeaders() });
    let status = payment.payment_status as string;
    if (synchronizeProvider && status === "pending" && payment.provider === "midtrans" && payment.provider_order_id) {
      try {
        const providerStatus = await new MidtransProvider().getPaymentStatus(payment.provider_order_id);
        const next = providerStatus === "settled" ? "settled" : providerStatus === "expired" ? "expired" : providerStatus === "failed" ? "failed" : "pending";
        const transitionData = await query<{ payment_status: string }>("select * from public.apply_payment_transition($1::uuid, $2::public.payment_status, $3, $4, $5, $6::timestamptz)", [payment.payment_id, next, providerStatus, null, 0, next === "settled" ? new Date().toISOString() : null]);
        const transitionRow = transitionData.rows[0];
        status = transitionRow?.payment_status ?? status;
      } catch {
        // Keep the stored state during provider outages.
      }
    }
    return NextResponse.json({ orderNumber: order.order_number, orderStatus: status === "settled" ? "paid" : order.order_status, paymentStatus: status, expiresAt: payment.expires_at, amountIdr: payment.amount_idr, ...presentQrMaterial(status === "pending" ? payment.qr_string : null) }, { headers: noStoreHeaders() });
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
