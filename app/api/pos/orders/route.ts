import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { cashierOrderSchema } from "@/lib/schemas";
import { jakartaDayRange } from "@/lib/reports";
import { createProviderPayment } from "@/lib/payments/create-provider-payment";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { checkoutDatabaseFailure, checkoutIntentMissing, checkoutQrMissing, checkoutUnexpectedFailure, invalidCheckoutInput } from "@/lib/domain/checkout-errors";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

export const runtime = "nodejs";

function fingerprint(input: { tableId: string | null; paymentMethod: string; items: Array<{ productId: string; quantity: number; variantOptionIds: string[]; addonOptionIds: string[]; note?: string }> }) {
  const canonical = {
    tableId: input.tableId,
    paymentMethod: input.paymentMethod,
    items: input.items
      .map((item) => ({ ...item, variantOptionIds: [...item.variantOptionIds].sort(), addonOptionIds: [...item.addonOptionIds].sort() }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function GET(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Staff authorization is insufficient.", "Staff authorization required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    let range;
    try {
      range = jakartaDayRange(date);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_REPORT_DATE") return NextResponse.json({ error: "Tanggal laporan tidak valid." }, { status: 400, headers: noStoreHeaders() });
      throw error;
    }
    const ordersResult = await query<{ id: string; order_number: string; table_id: string | null; status: string; total_idr: number; created_at: string; table_label: string | null; payment_method: string | null; payment_status: string | null; payment_created_at: string | null; orphaned_settlement: boolean }>(
      `select o.id, o.order_number, o.table_id, o.status, o.total_idr, o.created_at, rt.label as table_label,
              lp.method as payment_method, lp.status as payment_status, lp.created_at as payment_created_at, coalesce(lp.orphaned_settlement, false) as orphaned_settlement
       from public.orders o
       left join public.restaurant_tables rt on rt.id = o.table_id
       left join lateral (select p.method, p.status, p.created_at, p.orphaned_settlement from public.payments p where p.order_id = o.id order by p.created_at desc limit 1) lp on true
       where o.created_at >= $1 and o.created_at < $2 and o.status <> 'draft'
       order by o.created_at desc`,
      [range.start, range.end],
    );
    const data = ordersResult.rows;
    const orderIds = data.map((order) => order.id);
    const itemCountsResult = orderIds.length ? await query<{ order_id: string; quantity: number }>("select order_id, quantity from public.order_items where order_id = any($1::uuid[])", [orderIds]) : { rows: [] as Array<{ order_id: string; quantity: number }> };
    const counts = new Map<string, number>();
    for (const item of itemCountsResult.rows) counts.set(item.order_id, (counts.get(item.order_id) ?? 0) + item.quantity);
    return NextResponse.json({ orders: data.map((order) => {
      const status = order.status === "awaiting_payment" ? "Pending" : order.status === "paid" ? "New" : order.status === "accepted" ? "Accepted" : order.status === "processing" ? "Preparing" : order.status === "ready" ? "Ready" : order.status === "completed" ? "Completed" : order.status === "cancelled" ? "Cancelled" : order.status === "refunded" ? "Refunded" : "Pending";
      const paymentStatus = order.orphaned_settlement ? "Needs reconciliation"
        : order.payment_status === "settled" ? "Paid"
          : order.payment_status === "partially_refunded" ? "Partially refunded"
            : order.payment_status === "refunded" ? "Refunded"
              : order.payment_status === "failed" ? "Failed"
                : order.payment_status === "expired" ? "Expired"
                  : order.payment_status === "pending" ? "Pending" : "Unavailable";
      return { id: order.id, number: order.order_number, table: order.table_label ?? undefined, items: counts.get(order.id) ?? 0, total: order.total_idr, payment: order.payment_method === "cash" ? "Cash" : "QRIS", paymentStatus, status, time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(order.created_at)) };
    }) }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_orders_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Pesanan belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Staff authorization is insufficient.", "Staff authorization required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = cashierOrderSchema.safeParse(body);
  if (!parsed.success) {
    const failure = invalidCheckoutInput(parsed.error.issues[0]);
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
  const input = parsed.data;
  try {
    let intentResult;
    try {
      intentResult = await query<{ order_id: string; order_number: string; payment_id: string; payment_status: string; amount_idr: number; provider_order_id: string; qr_string: string | null; created_at: string | Date | null; expires_at: string | Date | null; replayed: boolean }>(
        `select * from public.create_checkout_intent($1::uuid, $2, $3::text, $4::uuid, $5::uuid, $6::public.payment_method, $7::jsonb)`,
        [input.idempotencyKey, fingerprint({ tableId: input.tableId ?? null, paymentMethod: input.paymentMethod, items: input.items }), null, input.tableId ?? null, auth.actorId, input.paymentMethod, JSON.stringify(input.items)],
      );
    } catch (error) {
      const failure = checkoutDatabaseFailure(error, "staff");
      return NextResponse.json(failure, { status: failure.status, headers: { ...noStoreHeaders(), ...(failure.code === "QR_RESERVATION_CAPACITY" ? { "Retry-After": "60" } : {}) } });
    }
    const intent = intentResult.rows[0];
    if (!intent) {
      const failure = checkoutIntentMissing();
      return NextResponse.json({ ...failure, error: failure.error.replace("Checkout", "Pesanan kasir") }, { status: failure.status, headers: noStoreHeaders() });
    }
    if (input.paymentMethod === "cash") return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, paymentStatus: "settled", replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
    if (intent.payment_status === "settled") return NextResponse.json({ code: "ORDER_ALREADY_PAID", error: "Pesanan ini sudah lunas. Tidak perlu membuat QR baru.", orderId: intent.order_id, orderNumber: intent.order_number, paymentStatus: intent.payment_status }, { status: 409, headers: noStoreHeaders() });
    let qrString: string | null = null;
    let qrImageUrl: string | null = null;
    let expiresAt = intent.expires_at ? new Date(intent.expires_at).toISOString() : null;
    if (intent.payment_status === "pending") {
      const providerPayment = await createProviderPayment(intent, requestId);
      if (!providerPayment.ok) return NextResponse.json({ ...providerPayment, orderId: intent.order_id }, { status: providerPayment.status, headers: noStoreHeaders() });
      qrString = providerPayment.qrString;
      qrImageUrl = providerPayment.qrImageUrl;
      expiresAt = providerPayment.expiresAt;
    }
    if (!qrString && !qrImageUrl) {
      const failure = checkoutQrMissing(intent.order_id);
      return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
    }
    return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, paymentId: intent.payment_id, qrString, qrImageUrl, expiresAt, replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "cashier_order_create_failed", requestId, { errorType: error instanceof Error ? error.name : "unknown" });
    const failure = checkoutUnexpectedFailure("staff");
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
}
