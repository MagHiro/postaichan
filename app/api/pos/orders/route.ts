import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { jakartaDayRange } from "@/lib/reports";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { MidtransProvider } from "@/lib/payments/midtrans";

export const runtime = "nodejs";

const cashierOrderSchema = z.object({
  idempotencyKey: z.string().min(16).max(120),
  orderType: z.enum(["dine_in", "takeaway"]),
  tableId: z.string().uuid().nullable().optional(),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1).max(50),
});

export async function GET(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    const range = jakartaDayRange(date);
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("orders").select("id, order_number, order_type, table_id, status, total_idr, created_at, restaurant_tables(label), payments(method, status)").gte("created_at", range.start).lt("created_at", range.end).neq("status", "draft").order("created_at", { ascending: false });
    if (error) throw error;
    const orderIds = (data ?? []).map((order) => order.id);
    const { data: itemCounts } = orderIds.length ? await supabase.from("order_items").select("order_id, quantity").in("order_id", orderIds) : { data: [] };
    const counts = new Map<string, number>();
    for (const item of itemCounts ?? []) counts.set(item.order_id, (counts.get(item.order_id) ?? 0) + item.quantity);
    return NextResponse.json({ orders: (data ?? []).map((order) => { const payment = Array.isArray(order.payments) ? order.payments[0] : order.payments; const table = Array.isArray(order.restaurant_tables) ? order.restaurant_tables[0] : order.restaurant_tables; return { id: order.id, number: order.order_number, type: order.order_type === "dine_in" ? "Dine in" : "Takeaway", table: table?.label, items: counts.get(order.id) ?? 0, total: order.total_idr, payment: payment?.method === "cash" ? "Cash" : "QRIS", paymentStatus: payment?.status === "settled" ? "Paid" : "Pending", status: order.status === "paid" || order.status === "accepted" || order.status === "awaiting_payment" ? "New" : order.status === "processing" ? "Preparing" : order.status === "ready" ? "Ready" : "Completed", time: new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "2-digit", minute: "2-digit" }).format(new Date(order.created_at)) }; }) });
  } catch (error) {
    console.error("pos_orders_failed", error);
    return NextResponse.json({ error: "Orders could not be loaded." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  const parsed = cashierOrderSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cashier order is incomplete." }, { status: 400 });
  try {
    const supabase = createAdminClient();
    const input = parsed.data;
    const { data: existing } = await supabase.from("orders").select("id, order_number, total_idr").eq("idempotency_key", input.idempotencyKey).maybeSingle();
    if (existing) {
      // Replayed tap (double-click / retry): hand back the pending payment so
      // the cashier QR modal can reopen instead of erroring with no QR.
      const { data: existingPayment } = await supabase.from("payments").select("qr_string, expires_at, status").eq("order_id", existing.id).order("created_at", { ascending: false }).limit(1).single();
      if (existingPayment?.qr_string && existingPayment.status === "pending") {
        return NextResponse.json({ orderId: existing.id, orderNumber: existing.order_number, totalIdr: existing.total_idr, qrString: existingPayment.qr_string, expiresAt: existingPayment.expires_at, replayed: true });
      }
      return NextResponse.json({ orderId: existing.id, orderNumber: existing.order_number, totalIdr: existing.total_idr, replayed: true });
    }
    const { data: menu, error: menuError } = await supabase.from("products").select("id, name, price_idr, estimated_cost_idr, available, active").in("id", input.items.map((item) => item.productId));
    if (menuError) throw menuError;
    const byId = new Map((menu ?? []).map((product) => [product.id, product]));
    for (const item of input.items) { const product = byId.get(item.productId); if (!product || !product.active || !product.available) return NextResponse.json({ error: `${product?.name ?? "An item"} is unavailable.` }, { status: 409 }); }
    const lines = input.items.map((item) => { const product = byId.get(item.productId)!; return { product_id: product.id, product_name_snapshot: product.name, quantity: item.quantity, unit_price_idr: product.price_idr, unit_cost_snapshot_idr: product.estimated_cost_idr, line_total_idr: product.price_idr * item.quantity }; });
    const subtotal = lines.reduce((sum, line) => sum + line.line_total_idr, 0);
    const { data: orderNumber, error: numberError } = await supabase.rpc("next_order_number");
    if (numberError || !orderNumber) throw numberError ?? new Error("Order number unavailable.");
    const { data: order, error: orderError } = await supabase.from("orders").insert({ order_number: orderNumber, idempotency_key: input.idempotencyKey, order_type: input.orderType, table_id: input.tableId ?? null, status: "awaiting_payment", subtotal_idr: subtotal, total_idr: subtotal, estimated_cost_idr: lines.reduce((sum, line) => sum + line.unit_cost_snapshot_idr * line.quantity, 0), created_by: auth.actorId }).select("id, order_number, total_idr").single();
    if (orderError || !order) throw orderError ?? new Error("Order could not be created.");
    const { error: lineError } = await supabase.from("order_items").insert(lines.map((line) => ({ ...line, order_id: order.id })));
    if (lineError) throw lineError;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const providerOrderId = `${order.order_number}-${randomUUID().slice(0, 8)}`;
    const payment = await new MidtransProvider().createPayment({ providerOrderId, amountIdr: subtotal, expiresAt });
    const { error: paymentError } = await supabase.from("payments").insert({ order_id: order.id, provider: "midtrans", method: "qris", status: "pending", amount_idr: subtotal, provider_order_id: providerOrderId, provider_transaction_id: payment.providerTransactionId, qr_string: payment.qrString, expires_at: expiresAt.toISOString() });
    if (paymentError) throw paymentError;
    return NextResponse.json({ orderId: order.id, orderNumber: order.order_number, totalIdr: order.total_idr, qrString: payment.qrString, expiresAt: expiresAt.toISOString() }, { status: 201 });
  } catch (error) {
    console.error("cashier_order_create_failed", error);
    return NextResponse.json({ error: "Cashier order could not be created." }, { status: 503 });
  }
}
