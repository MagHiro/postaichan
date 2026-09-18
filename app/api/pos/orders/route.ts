import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { cashierOrderSchema } from "@/lib/schemas";
import { jakartaDayRange } from "@/lib/reports";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

function fingerprint(input: unknown) { return createHash("sha256").update(JSON.stringify(input)).digest("hex"); }

export async function GET(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401, headers: noStoreHeaders() });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    let range;
    try {
      range = jakartaDayRange(date);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_REPORT_DATE") return NextResponse.json({ error: "Invalid report date." }, { status: 400, headers: noStoreHeaders() });
      throw error;
    }
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("orders").select("id, order_number, order_type, table_id, status, total_idr, created_at, restaurant_tables(label), payments(method, status, created_at)").gte("created_at", range.start).lt("created_at", range.end).neq("status", "draft").order("created_at", { ascending: false });
    if (error) throw error;
    const orderIds = (data ?? []).map((order) => order.id);
    const { data: itemCounts, error: countError } = orderIds.length ? await supabase.from("order_items").select("order_id, quantity").in("order_id", orderIds) : { data: [], error: null };
    if (countError) throw countError;
    const counts = new Map<string, number>();
    for (const item of itemCounts ?? []) counts.set(item.order_id, (counts.get(item.order_id) ?? 0) + item.quantity);
    return NextResponse.json({ orders: (data ?? []).map((order) => { const payments = Array.isArray(order.payments) ? order.payments : order.payments ? [order.payments] : []; const payment = payments.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0]; const table = Array.isArray(order.restaurant_tables) ? order.restaurant_tables[0] : order.restaurant_tables; return { id: order.id, number: order.order_number, type: order.order_type === "dine_in" ? "Dine in" : "Takeaway", table: table?.label, items: counts.get(order.id) ?? 0, total: order.total_idr, payment: payment?.method === "cash" ? "Cash" : "QRIS", paymentStatus: payment?.status === "settled" ? "Paid" : "Pending", status: order.status === "paid" ? "New" : order.status === "accepted" || order.status === "processing" ? "Preparing" : order.status === "ready" ? "Ready" : order.status === "completed" ? "Completed" : "New", time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(order.created_at)) }; }) }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_orders_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Orders could not be loaded." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = cashierOrderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cashier order is incomplete." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("create_checkout_intent", {
      p_idempotency_key: input.idempotencyKey,
      p_idempotency_fingerprint: fingerprint({ orderType: input.orderType, tableId: input.tableId ?? null, paymentMethod: input.paymentMethod, items: input.items }),
      p_session_hash: null,
      p_order_type: input.orderType,
      p_table_id: input.tableId ?? null,
      p_actor_id: auth.actorId,
      p_payment_method: input.paymentMethod,
      p_items: input.items,
    });
    if (error) {
      const message = String(error.message || "").split(":")[0];
      const status = ["MENU_CONFLICT", "INVALID_MODIFIERS", "INVALID_QUANTITY", "CASH_DISABLED", "QRIS_DISABLED", "IDEMPOTENCY_KEY_REUSED"].includes(message) ? 409 : 503;
      return NextResponse.json({ error: message === "CASH_DISABLED" ? "Pembayaran tunai sedang tidak tersedia." : message === "QRIS_DISABLED" ? "Pembayaran QRIS sedang tidak tersedia." : "Pesanan kasir belum dapat dibuat." }, { status, headers: noStoreHeaders() });
    }
    const intent = Array.isArray(data) ? data[0] : data;
    if (!intent) return NextResponse.json({ error: "Pesanan kasir belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
    if (input.paymentMethod === "cash") return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, paymentStatus: "settled", replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
    const { data: storedPayment, error: storedPaymentError } = await supabase.from("payments").select("qr_string").eq("id", intent.payment_id).maybeSingle();
    if (storedPaymentError) throw storedPaymentError;
    const storedQr = (storedPayment?.qr_string ?? intent.qr_string) as string | null;
    let { qrString, qrImageUrl } = presentQrMaterial(storedQr);
    let expiresAt = intent.expires_at as string | null;
    if (intent.payment_status === "pending" && !qrString && !qrImageUrl) {
      const { data: claimed, error: claimError } = await supabase.rpc("claim_payment_provider_create", { p_payment_id: intent.payment_id });
      if (claimError) throw claimError;
      if (claimed !== true) return NextResponse.json({ error: "Pembayaran sedang disiapkan. Coba lagi sebentar." }, { status: 503, headers: noStoreHeaders() });
      try {
        const provider = await new MidtransProvider().createPayment({ providerOrderId: intent.provider_order_id, amountIdr: intent.amount_idr, expiresAt: new Date(intent.expires_at) });
        const { error: updateError } = await supabase.from("payments").update({ provider_transaction_id: provider.providerTransactionId ?? null, qr_string: provider.qrString ?? provider.qrImageUrl ?? null, expires_at: provider.expiresAt.toISOString(), provider_created_at: new Date().toISOString(), provider_creation_claimed_at: null }).eq("id", intent.payment_id).eq("status", "pending");
        if (updateError) throw updateError;
        qrString = provider.qrString ?? null; qrImageUrl = provider.qrImageUrl ?? null; expiresAt = provider.expiresAt.toISOString();
      } catch (providerError) {
        await supabase.rpc("release_payment_provider_create", { p_payment_id: intent.payment_id, p_error: providerError instanceof Error ? providerError.message : "provider_error" });
        return NextResponse.json({ error: "Pembayaran QRIS belum dapat dibuat. Coba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
      }
    }
    return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, paymentId: intent.payment_id, qrString, qrImageUrl, expiresAt, replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("cashier_order_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Cashier order could not be created." }, { status: 503, headers: noStoreHeaders() });
  }
}
