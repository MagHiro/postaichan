import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { describeMidtransError, MidtransProvider } from "@/lib/payments/midtrans";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { uuidParamSchema } from "@/lib/schemas";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!sameOrigin(request)) return NextResponse.json({ code: "INVALID_ORIGIN", error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const token = request.headers.get("x-order-access-token");
  if (!token) return NextResponse.json({ code: "SESSION_TOKEN_REQUIRED", error: "Token akses pesanan dibutuhkan." }, { status: 401, headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ code: "ORDER_NOT_FOUND", error: "Pesanan tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });

  try {
    const sessionHash = hashOpaqueToken(token);
    if (!(await consumeRateLimit(request, "customer-cancel", 8, 300, sessionHash.slice(0, 24)))) {
      return NextResponse.json({ code: "CANCEL_RATE_LIMITED", error: "Terlalu banyak percobaan pembatalan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    }

    const orderResult = await query<{ order_status: string; payment_id: string | null; payment_status: string | null; provider: string | null; provider_order_id: string | null }>(
      `select o.status as order_status, p.id as payment_id, p.status as payment_status, p.provider, p.provider_order_id
       from public.orders o
       join public.customer_sessions cs on cs.id = o.customer_session_id
       left join lateral (
         select p.id, p.status, p.provider, p.provider_order_id
         from public.payments p where p.order_id = o.id order by p.created_at desc limit 1
       ) p on true
       where o.id = $1 and cs.access_token_hash = $2 and cs.expires_at > timezone('utc', now())`,
      [id, sessionHash],
    );
    const order = orderResult.rows[0];
    if (!order) return NextResponse.json({ code: "ORDER_NOT_FOUND", error: "Pesanan tidak ditemukan atau sesi pemesanan sudah berakhir." }, { status: 404, headers: noStoreHeaders() });
    if (!["draft", "awaiting_payment"].includes(order.order_status)) {
      return NextResponse.json({ code: "ORDER_CANNOT_CANCEL", error: order.payment_status === "settled" ? "Pesanan sudah lunas dan tidak dapat dibatalkan dari halaman customer. Minta kasir memproses refund." : `Pesanan sudah berstatus ${order.order_status.replace(/_/g, " ")} dan tidak dapat dibatalkan.` }, { status: 409, headers: noStoreHeaders() });
    }

    if (order.payment_status === "pending" && order.provider === "midtrans" && order.provider_order_id) {
      try {
        await new MidtransProvider().expirePayment(order.provider_order_id);
      } catch (error) {
        const failure = describeMidtransError(error) ?? { code: "ORDER_CANCEL_PROVIDER_ERROR", error: "QR masih aktif di Midtrans, jadi pesanan belum dibatalkan. Coba lagi sebentar.", status: 503, retryable: true };
        return NextResponse.json({ ...failure, action: "cancel" }, { status: failure.status, headers: noStoreHeaders() });
      }
    }

    let cancelled;
    try {
      cancelled = await query<{ cancelled: boolean; order_status: string; payment_status: string | null }>("select * from public.cancel_customer_order($1::uuid, $2)", [id, sessionHash]);
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const code = rawMessage.split(":")[0];
      if (code === "ORDER_NOT_FOUND") return NextResponse.json({ code, error: "Pesanan tidak ditemukan atau sesi pemesanan sudah berakhir." }, { status: 404, headers: noStoreHeaders() });
      if (code === "SESSION_EXPIRED") return NextResponse.json({ code, error: "Sesi pemesanan sudah berakhir. Scan QR terbaru." }, { status: 401, headers: noStoreHeaders() });
      console.error("customer_order_cancel_failed", rawMessage || "unknown");
      return NextResponse.json({ code: "ORDER_CANCEL_DATABASE_ERROR", error: "Pesanan belum dibatalkan karena database gagal menyimpan perubahan. Coba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
    }
    const result = cancelled.rows[0];
    if (!result?.cancelled) return NextResponse.json({ code: "ORDER_STATE_CHANGED", error: result?.payment_status === "settled" ? "Pesanan sudah lunas dan tidak dapat dibatalkan." : "Pesanan sudah berubah. Muat ulang status pesanan lalu coba lagi." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ cancelled: true, orderStatus: result.order_status, paymentStatus: result.payment_status }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("customer_order_cancel_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ code: "ORDER_CANCEL_INTERNAL_ERROR", error: "Pesanan belum dibatalkan karena server gagal menyelesaikan permintaan. Coba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
  }
}
