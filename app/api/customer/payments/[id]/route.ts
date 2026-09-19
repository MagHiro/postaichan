import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { uuidParamSchema } from "@/lib/schemas";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

async function getPaymentStatus(request: Request, { params }: Context, synchronizeProvider: boolean) {
  const token = request.headers.get("x-order-access-token");
  const { id } = await params;
  if (!token) return NextResponse.json({ error: "Order access token required." }, { status: 401, headers: noStoreHeaders() });
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  try {
    const sessionHash = hashOpaqueToken(token);
    if (!(await consumeRateLimit(request, "payment-status", 30, 300, sessionHash.slice(0, 24)))) return NextResponse.json({ error: "Polling terlalu sering." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } });
    const sessionResult = await query<{ id: string; table_id: string | null; table_qr_version: number | null; source_table_id: string | null; source_table_qr_version: number | null; ordering_qr_code_id: string | null; ordering_qr_token_version: number | null }>("select id, table_id, table_qr_version, source_table_id, source_table_qr_version, ordering_qr_code_id, ordering_qr_token_version from public.customer_sessions where access_token_hash = $1 and expires_at > timezone('utc', now()) limit 1", [sessionHash]);
    const session = sessionResult.rows[0];
    if (!session) return NextResponse.json({ error: "Order session expired." }, { status: 401, headers: noStoreHeaders() });
    const sourceTableId = session.source_table_id ?? session.table_id;
    const sourceTableVersion = session.source_table_qr_version ?? session.table_qr_version;
    if (sourceTableId && (await query("select id from public.restaurant_tables where id = $1 and active = true and qr_token_version = $2", [sourceTableId, sourceTableVersion])).rowCount === 0) return NextResponse.json({ error: "This table QR is no longer active." }, { status: 410, headers: noStoreHeaders() });
    if (session.ordering_qr_code_id && (await query("select id from public.ordering_qr_codes where id = $1 and active = true and token_version = $2", [session.ordering_qr_code_id, session.ordering_qr_token_version])).rowCount === 0) return NextResponse.json({ error: "This ordering QR is no longer active." }, { status: 410, headers: noStoreHeaders() });
    const orderResult = await query<{ id: string; order_number: string; status: string }>("select id, order_number, status from public.orders where id = $1 and customer_session_id = $2", [id, session.id]);
    const order = orderResult.rows[0];
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const paymentResult = await query<{ id: string; provider: string; status: string; expires_at: string | null; amount_idr: number; provider_order_id: string; qr_string: string | null }>("select id, provider, status, expires_at, amount_idr, provider_order_id, qr_string from public.payments where order_id = $1 order by created_at desc limit 1", [id]);
    const payment = paymentResult.rows[0];
    if (!payment) return NextResponse.json({ error: "Payment not found." }, { status: 404, headers: noStoreHeaders() });
    let paymentStatus = payment.status as string;
    let orderStatus = order.status as string;
    if (synchronizeProvider && paymentStatus === "pending" && payment.provider === "midtrans" && payment.provider_order_id) {
      try {
        const providerStatus = await new MidtransProvider().getPaymentStatus(payment.provider_order_id);
        const transition = providerStatus === "settled" ? "settled" : providerStatus === "expired" ? "expired" : providerStatus === "failed" ? "failed" : "pending";
        const transitionData = await query<{ payment_status: string; order_status: string }>("select * from public.apply_payment_transition($1::uuid, $2::public.payment_status, $3, $4, $5, $6::timestamptz)", [payment.id, transition, providerStatus, null, 0, transition === "settled" ? new Date().toISOString() : null]);
        const transitionRow = transitionData.rows[0];
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

export async function GET(request: Request, context: Context) {
  return getPaymentStatus(request, context, false);
}

export async function POST(request: Request, context: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  return getPaymentStatus(request, context, true);
}
