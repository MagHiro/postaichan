import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { cashierOrderSchema } from "@/lib/schemas";
import { jakartaDayRange } from "@/lib/reports";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

function fingerprint(input: { orderType: string; tableId: string | null; paymentMethod: string; items: Array<{ productId: string; quantity: number; variantOptionIds: string[]; addonOptionIds: string[]; note?: string }> }) {
  const canonical = {
    orderType: input.orderType,
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
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    let range;
    try {
      range = jakartaDayRange(date);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_REPORT_DATE") return NextResponse.json({ error: "Invalid report date." }, { status: 400, headers: noStoreHeaders() });
      throw error;
    }
    const ordersResult = await query<{ id: string; order_number: string; order_type: string; table_id: string | null; status: string; total_idr: number; created_at: string; table_label: string | null; payment_method: string | null; payment_status: string | null; payment_created_at: string | null }>(
      `select o.id, o.order_number, o.order_type, o.table_id, o.status, o.total_idr, o.created_at, rt.label as table_label,
              lp.method as payment_method, lp.status as payment_status, lp.created_at as payment_created_at
       from public.orders o
       left join public.restaurant_tables rt on rt.id = o.table_id
       left join lateral (select p.method, p.status, p.created_at from public.payments p where p.order_id = o.id order by p.created_at desc limit 1) lp on true
       where o.created_at >= $1 and o.created_at < $2 and o.status <> 'draft'
       order by o.created_at desc`,
      [range.start, range.end],
    );
    const data = ordersResult.rows;
    const orderIds = data.map((order) => order.id);
    const itemCountsResult = orderIds.length ? await query<{ order_id: string; quantity: number }>("select order_id, quantity from public.order_items where order_id = any($1::uuid[])", [orderIds]) : { rows: [] as Array<{ order_id: string; quantity: number }> };
    const counts = new Map<string, number>();
    for (const item of itemCountsResult.rows) counts.set(item.order_id, (counts.get(item.order_id) ?? 0) + item.quantity);
    return NextResponse.json({ orders: data.map((order) => { const status = order.status === "awaiting_payment" ? "Pending" : order.status === "paid" ? "New" : order.status === "accepted" ? "Accepted" : order.status === "processing" ? "Preparing" : order.status === "ready" ? "Ready" : order.status === "completed" ? "Completed" : order.status === "cancelled" ? "Cancelled" : order.status === "refunded" ? "Refunded" : "Pending"; return { id: order.id, number: order.order_number, type: order.order_type === "dine_in" ? "Dine in" : "Takeaway", table: order.table_label ?? undefined, items: counts.get(order.id) ?? 0, total: order.total_idr, payment: order.payment_method === "cash" ? "Cash" : "QRIS", paymentStatus: order.payment_status === "settled" || order.payment_status === "partially_refunded" || order.payment_status === "refunded" ? "Paid" : "Pending", status, time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(order.created_at)) }; }) }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_orders_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Orders could not be loaded." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = cashierOrderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cashier order is incomplete." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    let intentResult;
    try {
      intentResult = await query<{ order_id: string; order_number: string; payment_id: string; payment_status: string; amount_idr: number; provider_order_id: string; qr_string: string | null; expires_at: string | null; replayed: boolean }>(
        `select * from public.create_checkout_intent($1::uuid, $2, $3::text, $4::public.order_type, $5::uuid, $6::uuid, $7::public.payment_method, $8::jsonb)`,
        [input.idempotencyKey, fingerprint({ orderType: input.orderType, tableId: input.tableId ?? null, paymentMethod: input.paymentMethod, items: input.items }), null, input.orderType, input.tableId ?? null, auth.actorId, input.paymentMethod, input.items],
      );
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.split(":")[0];
      const stockProduct = message === "STOCK_CONFLICT" ? rawMessage.slice("STOCK_CONFLICT:".length).trim().slice(0, 120) : "";
      const status = ["MENU_CONFLICT", "INVALID_MODIFIERS", "INVALID_QUANTITY", "INVALID_NOTE", "STOCK_CONFLICT", "CASH_DISABLED", "QRIS_DISABLED", "IDEMPOTENCY_KEY_REUSED", "TABLE_NOT_AVAILABLE", "TAKEAWAY_TABLE_CONFLICT"].includes(message) ? 409 : 503;
      return NextResponse.json({ error: message === "CASH_DISABLED" ? "Pembayaran tunai sedang tidak tersedia." : message === "QRIS_DISABLED" ? "Pembayaran QRIS sedang tidak tersedia." : message === "STOCK_CONFLICT" ? stockProduct ? `Stok ${stockProduct} berubah. Kurangi jumlah item lalu coba lagi.` : "Stok berubah. Kurangi jumlah item lalu coba lagi." : message === "TABLE_NOT_AVAILABLE" ? "Meja tidak aktif. Pilih meja lain." : message === "TAKEAWAY_TABLE_CONFLICT" ? "Takeaway tidak dapat memakai meja." : "Pesanan kasir belum dapat dibuat." }, { status, headers: noStoreHeaders() });
    }
    const intent = intentResult.rows[0];
    if (!intent) return NextResponse.json({ error: "Pesanan kasir belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
    if (input.paymentMethod === "cash") return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, paymentStatus: "settled", replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
    const storedPayment = await query<{ qr_string: string | null }>("select qr_string from public.payments where id = $1", [intent.payment_id]);
    const storedQr = storedPayment.rows[0]?.qr_string ?? intent.qr_string;
    let { qrString, qrImageUrl } = presentQrMaterial(storedQr);
    let expiresAt = intent.expires_at as string | null;
    if (intent.payment_status === "pending" && !qrString && !qrImageUrl) {
      const claimed = await query<{ claimed: boolean }>("select public.claim_payment_provider_create($1) as claimed", [intent.payment_id]);
      if (claimed.rows[0]?.claimed !== true) return NextResponse.json({ error: "Pembayaran sedang disiapkan. Coba lagi sebentar." }, { status: 503, headers: noStoreHeaders() });
      try {
        if (!intent.expires_at) throw new Error("PAYMENT_EXPIRY_MISSING");
        const provider = await new MidtransProvider().createPayment({ providerOrderId: intent.provider_order_id, amountIdr: intent.amount_idr, expiresAt: new Date(intent.expires_at) });
        await query(
          `update public.payments set provider_transaction_id = $2, qr_string = $3, expires_at = $4, provider_created_at = $5,
             provider_creation_claimed_at = null, provider_error = null, updated_at = timezone('utc', now())
           where id = $1 and status = 'pending'`,
          [intent.payment_id, provider.providerTransactionId ?? null, provider.qrString ?? provider.qrImageUrl ?? null, provider.expiresAt.toISOString(), new Date().toISOString()],
        );
        qrString = provider.qrString ?? null; qrImageUrl = provider.qrImageUrl ?? null; expiresAt = provider.expiresAt.toISOString();
      } catch (providerError) {
        await query("select public.release_payment_provider_create($1, $2)", [intent.payment_id, providerError instanceof Error ? providerError.message : "provider_error"]);
        return NextResponse.json({ error: "Pembayaran QRIS belum dapat dibuat. Coba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
      }
    }
    return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, paymentId: intent.payment_id, qrString, qrImageUrl, expiresAt, replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("cashier_order_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Cashier order could not be created." }, { status: 503, headers: noStoreHeaders() });
  }
}
