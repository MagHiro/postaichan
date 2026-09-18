import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyReport = {
  date: string; start: string; end: string; revenueIdr: number; orderCount: number; averageOrderValueIdr: number; estimatedCogsIdr: number; paymentFeesIdr: number; estimatedGrossProfitIdr: number; dineInRevenueIdr: number; takeawayRevenueIdr: number;
  bestSellers: Array<{ name: string; quantity: number; revenueIdr: number }>;
  orders: Array<{ orderNumber: string; createdAt: string; type: string; totalIdr: number; estimatedCostIdr: number; status: string }>;
};

export function netRecognizedPayment(payment: { status: string; amount_idr: number; refunded_amount_idr?: number | null; orphaned_settlement?: boolean | null }) {
  if (payment.orphaned_settlement || !["settled", "partially_refunded", "refunded"].includes(payment.status)) return 0;
  return Math.max(0, payment.amount_idr - (payment.refunded_amount_idr ?? (payment.status === "refunded" ? payment.amount_idr : 0)));
}

export function jakartaDate(value?: string) {
  if (value === undefined) return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_REPORT_DATE");
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime()) || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(parsed) !== value) throw new Error("INVALID_REPORT_DATE");
  return value;
}

export function jakartaDayRange(value?: string) {
  const date = jakartaDate(value);
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date, start: start.toISOString(), end: end.toISOString() };
}

export async function getDailyReport(supabase: SupabaseClient, value?: string): Promise<DailyReport> {
  const range = jakartaDayRange(value);
  const { data: orders, error: orderError } = await supabase.from("orders").select("id, order_number, order_type, status, total_idr, estimated_cost_idr, created_at").gte("created_at", range.start).lt("created_at", range.end).order("created_at", { ascending: true });
  if (orderError) throw orderError;
  const orderRows = orders ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const [{ data: payments, error: paymentError }, { data: items, error: itemError }] = await Promise.all([
    orderIds.length ? supabase.from("payments").select("id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? supabase.from("order_items").select("order_id, product_name_snapshot, quantity, line_total_idr, unit_cost_snapshot_idr").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (paymentError) throw paymentError;
  if (itemError) throw itemError;
  const paymentByOrder = new Map<string, (typeof payments)[number]>();
  for (const payment of payments ?? []) {
    if (payment.orphaned_settlement === true || !(payment.status === "settled" || payment.status === "partially_refunded" || payment.status === "refunded")) continue;
    const previous = paymentByOrder.get(payment.order_id);
    if (!previous || String(payment.settled_at ?? payment.created_at ?? "") < String(previous.settled_at ?? previous.created_at ?? "")) paymentByOrder.set(payment.order_id, payment);
  }
  const financialOrders = orderRows.filter((order) => paymentByOrder.has(order.id));
  const recognized = financialOrders.map((order) => ({ order, payment: paymentByOrder.get(order.id)! })).map(({ order, payment }) => ({ order, payment, netIdr: netRecognizedPayment(payment) }));
  const revenueIdr = recognized.reduce((sum, row) => sum + row.netIdr, 0);
  const paymentFeesIdr = recognized.reduce((sum, row) => sum + (row.payment.fee_idr ?? 0), 0);
  const recognizedIds = new Set(recognized.filter((row) => row.netIdr > 0).map((row) => row.order.id));
  const recognizedByOrder = new Map(recognized.map((row) => [row.order.id, row]));
  const itemRows = (items ?? []).filter((item) => recognizedIds.has(item.order_id));
  // Partial refunds are amount-level records, not item-level allocations. Prorate
  // immutable snapshot COGS and line revenue so the report remains internally
  // consistent without inventing a product allocation that was never recorded.
  const estimatedCogsIdr = itemRows.reduce((sum, item) => {
    const row = recognizedByOrder.get(item.order_id)!;
    const ratio = row.payment.amount_idr > 0 ? row.netIdr / row.payment.amount_idr : 0;
    return sum + Math.round(item.unit_cost_snapshot_idr * item.quantity * ratio);
  }, 0);
  const byProduct = new Map<string, { quantity: number; revenueIdr: number }>();
  for (const item of itemRows) {
    const row = recognizedByOrder.get(item.order_id)!;
    const ratio = row.payment.amount_idr > 0 ? row.netIdr / row.payment.amount_idr : 0;
    const previous = byProduct.get(item.product_name_snapshot) ?? { quantity: 0, revenueIdr: 0 };
    byProduct.set(item.product_name_snapshot, { quantity: previous.quantity + item.quantity, revenueIdr: previous.revenueIdr + Math.round(item.line_total_idr * ratio) });
  }
  const bestSellers = [...byProduct.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 8).map(([name, values]) => ({ name, ...values }));
  const payable = recognized.filter((row) => row.netIdr > 0);
  return { ...range, revenueIdr, orderCount: payable.length, averageOrderValueIdr: payable.length ? Math.round(revenueIdr / payable.length) : 0, estimatedCogsIdr, paymentFeesIdr, estimatedGrossProfitIdr: revenueIdr - estimatedCogsIdr - paymentFeesIdr, dineInRevenueIdr: payable.filter((row) => row.order.order_type === "dine_in").reduce((sum, row) => sum + row.netIdr, 0), takeawayRevenueIdr: payable.filter((row) => row.order.order_type === "takeaway").reduce((sum, row) => sum + row.netIdr, 0), bestSellers, orders: payable.map((row) => ({ orderNumber: row.order.order_number, createdAt: row.order.created_at, type: row.order.order_type, totalIdr: row.netIdr, estimatedCostIdr: row.order.estimated_cost_idr, status: row.order.status })) };
}
