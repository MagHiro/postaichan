import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyReport = {
  date: string;
  start: string;
  end: string;
  revenueIdr: number;
  orderCount: number;
  averageOrderValueIdr: number;
  estimatedCogsIdr: number;
  paymentFeesIdr: number;
  estimatedGrossProfitIdr: number;
  dineInRevenueIdr: number;
  takeawayRevenueIdr: number;
  bestSellers: Array<{ name: string; quantity: number; revenueIdr: number }>;
  orders: Array<{ orderNumber: string; createdAt: string; type: string; totalIdr: number; estimatedCostIdr: number; status: string }>;
};

export function jakartaDate(value?: string) {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function jakartaDayRange(value?: string) {
  const date = jakartaDate(value);
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date, start: start.toISOString(), end: end.toISOString() };
}

export async function getDailyReport(supabase: SupabaseClient, value?: string): Promise<DailyReport> {
  const range = jakartaDayRange(value);
  const { data: orders, error: orderError } = await supabase.from("orders").select("id, order_number, order_type, status, total_idr, estimated_cost_idr, created_at").gte("created_at", range.start).lt("created_at", range.end).not("status", "in", "(draft,awaiting_payment,cancelled,refunded)").order("created_at", { ascending: true });
  if (orderError) throw orderError;
  const orderRows = orders ?? [];
  const orderIds = orderRows.map((order) => order.id);
  const [{ data: payments, error: paymentError }, { data: items, error: itemError }] = await Promise.all([
    orderIds.length ? supabase.from("payments").select("order_id, status, fee_idr").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
    orderIds.length ? supabase.from("order_items").select("order_id, product_name_snapshot, quantity, line_total_idr, unit_cost_snapshot_idr").in("order_id", orderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (paymentError) throw paymentError;
  if (itemError) throw itemError;
  const settledOrderIds = new Set((payments ?? []).filter((payment) => ["settled", "partially_refunded"].includes(payment.status)).map((payment) => payment.order_id));
  const paidOrders = orderRows.filter((order) => settledOrderIds.has(order.id));
  const revenueIdr = paidOrders.reduce((sum, order) => sum + order.total_idr, 0);
  const paymentFeesIdr = (payments ?? []).filter((payment) => settledOrderIds.has(payment.order_id)).reduce((sum, payment) => sum + (payment.fee_idr ?? 0), 0);
  const itemRows = (items ?? []).filter((item) => settledOrderIds.has(item.order_id));
  const estimatedCogsIdr = itemRows.reduce((sum, item) => sum + item.unit_cost_snapshot_idr * item.quantity, 0);
  const byProduct = new Map<string, { quantity: number; revenueIdr: number }>();
  for (const item of itemRows) {
    const previous = byProduct.get(item.product_name_snapshot) ?? { quantity: 0, revenueIdr: 0 };
    byProduct.set(item.product_name_snapshot, { quantity: previous.quantity + item.quantity, revenueIdr: previous.revenueIdr + item.line_total_idr });
  }
  const bestSellers = [...byProduct.entries()].sort((a, b) => b[1].quantity - a[1].quantity).slice(0, 8).map(([name, values]) => ({ name, ...values }));
  return {
    ...range,
    revenueIdr,
    orderCount: paidOrders.length,
    averageOrderValueIdr: paidOrders.length ? Math.round(revenueIdr / paidOrders.length) : 0,
    estimatedCogsIdr,
    paymentFeesIdr,
    estimatedGrossProfitIdr: revenueIdr - estimatedCogsIdr - paymentFeesIdr,
    dineInRevenueIdr: paidOrders.filter((order) => order.order_type === "dine_in").reduce((sum, order) => sum + order.total_idr, 0),
    takeawayRevenueIdr: paidOrders.filter((order) => order.order_type === "takeaway").reduce((sum, order) => sum + order.total_idr, 0),
    bestSellers,
    orders: paidOrders.map((order) => ({ orderNumber: order.order_number, createdAt: order.created_at, type: order.order_type, totalIdr: order.total_idr, estimatedCostIdr: order.estimated_cost_idr, status: order.status })),
  };
}
