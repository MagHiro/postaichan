import "server-only";
import { query } from "@/lib/db";
import type { ReceiptData, ReceiptLine, ReceiptSettings } from "@/lib/receipt-types";

export async function loadReceiptSettings(): Promise<ReceiptSettings> {
  const result = await query<ReceiptSettings>(
    "select merchant_name, address, footer, paper_width_mm, ble_service_uuid, ble_characteristic_uuid from public.receipt_settings where id=true",
  );
  const settings = result.rows[0];
  if (!settings) throw new Error("RECEIPT_SETTINGS_MISSING");
  return settings;
}

type ReceiptOrder = {
  order_number: string; customer_name: string | null; table_label: string | null;
  created_at: Date | string; subtotal_idr: number; total_idr: number;
  method: "cash" | "qris" | null; provider: string | null; payment_status: string | null;
};
type DbLine = {
  id: string; product_name_snapshot: string; quantity: number; unit_price_idr: number;
  line_total_idr: number; note: string | null; modifier_name_snapshot: string | null;
};

export async function loadReceipt(orderId: string): Promise<ReceiptData | null> {
  const [orders, items, settings] = await Promise.all([
    query<ReceiptOrder>(
      `select o.order_number, o.customer_name, rt.label as table_label, o.created_at,
        o.subtotal_idr, o.total_idr, p.method, p.provider, p.status as payment_status
       from public.orders o
       left join public.restaurant_tables rt on rt.id=o.table_id
       left join lateral (
         select method, provider, status from public.payments
         where order_id=o.id order by created_at desc limit 1
       ) p on true where o.id=$1 and o.status <> 'draft'`,
      [orderId],
    ),
    query<DbLine>(
      `select oi.id, oi.product_name_snapshot, oi.quantity, oi.unit_price_idr, oi.line_total_idr,
        oi.note, oim.modifier_name_snapshot
       from public.order_items oi left join public.order_item_modifiers oim on oim.order_item_id=oi.id
       where oi.order_id=$1 order by oi.created_at, oi.id, oim.modifier_name_snapshot`,
      [orderId],
    ),
    loadReceiptSettings(),
  ]);
  const order = orders.rows[0];
  if (!order) return null;
  const lineMap = new Map<string, ReceiptLine>();
  for (const item of items.rows) {
    let line = lineMap.get(item.id);
    if (!line) {
      line = { name: item.product_name_snapshot, quantity: item.quantity, unitPriceIdr: item.unit_price_idr,
        lineTotalIdr: item.line_total_idr, note: item.note, modifiers: [] };
      lineMap.set(item.id, line);
    }
    if (item.modifier_name_snapshot) line.modifiers.push(item.modifier_name_snapshot);
  }
  return {
    orderNumber: order.order_number,
    customerName: order.customer_name,
    tableLabel: order.table_label,
    createdAt: new Date(order.created_at).toISOString(),
    paymentLabel: order.method === "cash" ? "Tunai" : order.provider === "manual_qris" ? "QRIS manual" : "QRIS otomatis",
    paymentStatus: order.payment_status ?? "pending",
    subtotalIdr: order.subtotal_idr, totalIdr: order.total_idr,
    lines: [...lineMap.values()], settings,
  };
}
