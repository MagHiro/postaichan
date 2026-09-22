import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { uuidParamSchema } from "@/lib/schemas";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";
type OrderItemDetail = { id: string; product_name_snapshot: string; image_url: string | null; quantity: number; unit_price_idr: number; line_total_idr: number; note: string | null; order_item_modifiers: Array<{ modifier_type: string; modifier_name_snapshot: string; price_adjustment_idr: number }> };

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  try {
    const [orderResult, itemsResult] = await Promise.all([
      query("select o.id, o.order_number, o.order_type, o.status, o.subtotal_idr, o.total_idr, o.created_at, rt.label as table_label, p.method, p.provider, p.status as payment_status, p.amount_idr, p.expires_at, p.settled_at, p.created_at as payment_created_at from public.orders o left join public.restaurant_tables rt on rt.id = o.table_id left join public.payments p on p.order_id = o.id where o.id = $1 order by p.created_at desc", [id]),
      query("select oi.id, oi.product_name_snapshot, p.image_path as image_url, oi.quantity, oi.unit_price_idr, oi.line_total_idr, oi.note, oim.modifier_type, oim.modifier_name_snapshot, oim.price_adjustment_idr from public.order_items oi left join public.products p on p.id = oi.product_id left join public.order_item_modifiers oim on oim.order_item_id = oi.id where oi.order_id = $1 order by oi.created_at asc, oim.modifier_type asc", [id]),
    ]);
    const first = orderResult.rows[0];
    if (!first) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    const order = { id: first.id, order_number: first.order_number, order_type: first.order_type, status: first.status, subtotal_idr: first.subtotal_idr, total_idr: first.total_idr, created_at: first.created_at, restaurant_tables: first.table_label ? { label: first.table_label } : null, payments: orderResult.rows.filter((row) => row.method).map((row) => ({ method: row.method, provider: row.provider, status: row.payment_status, amount_idr: row.amount_idr, expires_at: row.expires_at, settled_at: row.settled_at, created_at: row.payment_created_at })) };
    const itemMap = new Map<string, OrderItemDetail>();
    for (const row of itemsResult.rows) {
      const item: OrderItemDetail = itemMap.get(row.id) ?? { id: row.id, product_name_snapshot: row.product_name_snapshot, image_url: row.image_url, quantity: row.quantity, unit_price_idr: row.unit_price_idr, line_total_idr: row.line_total_idr, note: row.note, order_item_modifiers: [] };
      if (row.modifier_type) item.order_item_modifiers.push({ modifier_type: row.modifier_type, modifier_name_snapshot: row.modifier_name_snapshot, price_adjustment_idr: row.price_adjustment_idr });
      itemMap.set(row.id, item);
    }
    return NextResponse.json({ order, items: [...itemMap.values()] }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_order_detail_failed", error);
    return NextResponse.json({ error: "Detail pesanan belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
