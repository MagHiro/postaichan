import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  const { id } = await params;
  try {
    const supabase = createAdminClient();
    const [{ data: order, error: orderError }, { data: items, error: itemError }] = await Promise.all([
      supabase.from("orders").select("id, order_number, order_type, status, subtotal_idr, total_idr, estimated_cost_idr, created_at, restaurant_tables(label), payments(method, provider, status, amount_idr, fee_idr, provider_order_id, expires_at, settled_at, created_at)").eq("id", id).single(),
      supabase.from("order_items").select("id, product_name_snapshot, quantity, unit_price_idr, unit_cost_snapshot_idr, line_total_idr, note, order_item_modifiers(modifier_type, modifier_name_snapshot, price_adjustment_idr)").eq("order_id", id),
    ]);
    if (orderError) throw orderError;
    if (itemError) throw itemError;
    return NextResponse.json({ order, items: items ?? [] });
  } catch (error) {
    console.error("pos_order_detail_failed", error);
    return NextResponse.json({ error: "Order detail could not be loaded." }, { status: 503 });
  }
}
