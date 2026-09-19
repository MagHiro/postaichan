import type { SupabaseClient } from "@supabase/supabase-js";

const REPORT_TIME_ZONE = "Asia/Jakarta";
const MAX_REPORT_DAYS = 31;
const RECOGNIZED_PAYMENT_STATUSES = ["settled", "partially_refunded", "refunded"] as const;

type PaymentRow = {
  id: string;
  order_id: string;
  status: string;
  amount_idr: number;
  fee_idr?: number | null;
  refunded_amount_idr?: number | null;
  orphaned_settlement?: boolean | null;
  settled_at?: string | null;
  created_at?: string | null;
};

type RefundRow = { id: string; payment_id: string; amount_idr: number; processed_at: string; reason?: string | null };
type OrderRow = { id: string; order_number: string; order_type: string; status: string; total_idr: number; estimated_cost_idr: number; created_at: string };
type ItemRow = { order_id: string; product_name_snapshot: string; quantity: number; line_total_idr: number; unit_cost_snapshot_idr: number };

export type ReportDay = { date: string; grossRevenueIdr: number; refundsIdr: number; netRevenueIdr: number; paidOrderCount: number };

export type DailyReport = {
  date: string;
  from: string;
  to: string;
  start: string;
  end: string;
  grossRevenueIdr: number;
  refundsIdr: number;
  netRevenueIdr: number;
  revenueIdr: number;
  orderCount: number;
  averageOrderValueIdr: number;
  estimatedCogsIdr: number;
  paymentFeesIdr: number;
  estimatedGrossProfitIdr: number;
  dineInRevenueIdr: number;
  takeawayRevenueIdr: number;
  paymentMethodMix: Array<{ method: string; amountIdr: number; orderCount: number }>;
  dailyBreakdown: ReportDay[];
  bestSellers: Array<{ name: string; quantity: number; revenueIdr: number }>;
  orders: Array<{ orderNumber: string; createdAt: string; settledAt: string; type: string; totalIdr: number; estimatedCostIdr: number; status: string }>;
};

export function netRecognizedPayment(payment: { status: string; amount_idr: number; refunded_amount_idr?: number | null; orphaned_settlement?: boolean | null }) {
  if (payment.orphaned_settlement || !RECOGNIZED_PAYMENT_STATUSES.includes(payment.status as (typeof RECOGNIZED_PAYMENT_STATUSES)[number])) return 0;
  return Math.max(0, payment.amount_idr - (payment.refunded_amount_idr ?? (payment.status === "refunded" ? payment.amount_idr : 0)));
}

export function jakartaDate(value?: string) {
  if (value === undefined) return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_REPORT_DATE");
  const parsed = new Date(`${value}T00:00:00+07:00`);
  if (Number.isNaN(parsed.getTime()) || new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE }).format(parsed) !== value) throw new Error("INVALID_REPORT_DATE");
  return value;
}

export function jakartaDayRange(value?: string) {
  const date = jakartaDate(value);
  const start = new Date(`${date}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { date, from: date, to: date, start: start.toISOString(), end: end.toISOString() };
}

export function jakartaRange(fromValue?: string, toValue?: string) {
  const from = jakartaDate(fromValue);
  const to = jakartaDate(toValue ?? from);
  const start = new Date(`${from}T00:00:00+07:00`);
  const end = new Date(`${to}T00:00:00+07:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  if (to < from || days < 1 || days > MAX_REPORT_DAYS) throw new Error("REPORT_RANGE_LIMIT");
  return { date: from, from, to, start: start.toISOString(), end: end.toISOString(), days };
}

function dateInJakarta(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function methodLabel(method: string) {
  return method.toLowerCase() === "cash" ? "cash" : "qris";
}

export async function getReport(supabase: SupabaseClient, fromValue?: string, toValue?: string): Promise<DailyReport> {
  const range = jakartaRange(fromValue, toValue);
  const { data: candidatePayments, error: candidatePaymentError } = await supabase
    .from("payments")
    .select("id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at, method")
    .in("status", [...RECOGNIZED_PAYMENT_STATUSES])
    .eq("orphaned_settlement", false)
    .not("settled_at", "is", null)
    .gte("settled_at", range.start)
    .lt("settled_at", range.end)
    .order("settled_at", { ascending: true });
  if (candidatePaymentError) throw candidatePaymentError;

  const candidateRows = (candidatePayments ?? []) as Array<PaymentRow & { method: string }>;
  const candidateOrderIds = [...new Set(candidateRows.map((row) => row.order_id))];
  const { data: allOrderPayments, error: allPaymentError } = candidateOrderIds.length
    ? await supabase.from("payments").select("id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at, method").in("order_id", candidateOrderIds).in("status", [...RECOGNIZED_PAYMENT_STATUSES]).not("settled_at", "is", null).order("settled_at", { ascending: true })
    : { data: [], error: null };
  if (allPaymentError) throw allPaymentError;

  const primaryByOrder = new Map<string, PaymentRow & { method: string }>();
  for (const row of (allOrderPayments ?? []) as Array<PaymentRow & { method: string }>) {
    if (row.orphaned_settlement !== true && row.settled_at && !primaryByOrder.has(row.order_id)) primaryByOrder.set(row.order_id, row);
  }
  const settlementRows = [...primaryByOrder.values()].filter((row) => row.settled_at! >= range.start && row.settled_at! < range.end);
  const settlementPaymentIds = settlementRows.map((row) => row.id);

  const [{ data: refunds, error: refundError }, { data: orders, error: orderError }] = await Promise.all([
    supabase.from("payment_refunds").select("id, payment_id, amount_idr, processed_at, reason").gte("processed_at", range.start).lt("processed_at", range.end).order("processed_at", { ascending: true }),
    candidateOrderIds.length ? supabase.from("orders").select("id, order_number, order_type, status, total_idr, estimated_cost_idr, created_at").in("id", candidateOrderIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (refundError) throw refundError;
  if (orderError) throw orderError;

  const refundRows = (refunds ?? []) as RefundRow[];
  const refundPaymentIds = [...new Set(refundRows.map((row) => row.payment_id))];
  const extraPaymentIds = refundPaymentIds.filter((id) => !settlementPaymentIds.includes(id));
  const { data: refundPayments, error: refundPaymentError } = extraPaymentIds.length
    ? await supabase.from("payments").select("id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at, method").in("id", extraPaymentIds)
    : { data: [], error: null };
  if (refundPaymentError) throw refundPaymentError;

  const paymentById = new Map<string, PaymentRow & { method: string }>();
  for (const row of settlementRows) paymentById.set(row.id, row);
  for (const row of (refundPayments ?? []) as Array<PaymentRow & { method: string }>) paymentById.set(row.id, row);
  const validRefunds = refundRows.filter((row) => {
    const payment = paymentById.get(row.payment_id);
    return payment && payment.orphaned_settlement !== true && RECOGNIZED_PAYMENT_STATUSES.includes(payment.status as (typeof RECOGNIZED_PAYMENT_STATUSES)[number]);
  });

  const allRelevantOrderIds = [...new Set([...settlementRows.map((row) => row.order_id), ...validRefunds.map((row) => paymentById.get(row.payment_id)?.order_id).filter((id): id is string => Boolean(id))])];
  const relevantOrders = new Map(((orders ?? []) as OrderRow[]).map((order) => [order.id, order]));
  const missingOrderIds = allRelevantOrderIds.filter((id) => !relevantOrders.has(id));
  if (missingOrderIds.length) {
    const { data: extraOrders, error: extraOrderError } = await supabase.from("orders").select("id, order_number, order_type, status, total_idr, estimated_cost_idr, created_at").in("id", missingOrderIds);
    if (extraOrderError) throw extraOrderError;
    for (const order of (extraOrders ?? []) as OrderRow[]) relevantOrders.set(order.id, order);
  }
  const { data: items, error: itemError } = allRelevantOrderIds.length
    ? await supabase.from("order_items").select("order_id, product_name_snapshot, quantity, line_total_idr, unit_cost_snapshot_idr").in("order_id", allRelevantOrderIds)
    : { data: [], error: null };
  if (itemError) throw itemError;
  const itemRows = (items ?? []) as ItemRow[];

  const refundsByPayment = new Map<string, number>();
  for (const refund of validRefunds) refundsByPayment.set(refund.payment_id, (refundsByPayment.get(refund.payment_id) ?? 0) + refund.amount_idr);
  const grossRevenueIdr = settlementRows.reduce((sum, row) => sum + row.amount_idr, 0);
  const refundsIdr = validRefunds.reduce((sum, row) => sum + row.amount_idr, 0);
  const netRevenueIdr = grossRevenueIdr - refundsIdr;
  const paymentFeesIdr = settlementRows.reduce((sum, row) => sum + (row.fee_idr ?? 0), 0);
  const settlementOrderIds = new Set(settlementRows.map((row) => row.order_id));
  const settlementItems = itemRows.filter((item) => settlementOrderIds.has(item.order_id));
  const estimatedCogsIdr = settlementItems.reduce((sum, item) => sum + item.unit_cost_snapshot_idr * item.quantity, 0);

  const byProduct = new Map<string, { quantity: number; revenueIdr: number }>();
  for (const item of settlementItems) {
    const previous = byProduct.get(item.product_name_snapshot) ?? { quantity: 0, revenueIdr: 0 };
    byProduct.set(item.product_name_snapshot, { quantity: previous.quantity + item.quantity, revenueIdr: previous.revenueIdr + item.line_total_idr });
  }
  const bestSellers = [...byProduct.entries()].sort((a, b) => b[1].quantity - a[1].quantity || b[1].revenueIdr - a[1].revenueIdr).slice(0, 8).map(([name, values]) => ({ name, ...values }));

  const refundByOrder = new Map<string, number>();
  for (const refund of validRefunds) {
    const orderId = paymentById.get(refund.payment_id)?.order_id;
    if (orderId) refundByOrder.set(orderId, (refundByOrder.get(orderId) ?? 0) + refund.amount_idr);
  }
  let dineInRevenueIdr = 0;
  let takeawayRevenueIdr = 0;
  for (const row of settlementRows) {
    const order = relevantOrders.get(row.order_id);
    const net = row.amount_idr - (refundByOrder.get(row.order_id) ?? 0);
    if (order?.order_type === "dine_in") dineInRevenueIdr += net;
    else takeawayRevenueIdr += net;
  }
  for (const refund of validRefunds) {
    const payment = paymentById.get(refund.payment_id);
    const order = payment ? relevantOrders.get(payment.order_id) : undefined;
    if (settlementOrderIds.has(payment?.order_id ?? "")) continue;
    if (order?.order_type === "dine_in") dineInRevenueIdr -= refund.amount_idr;
    else takeawayRevenueIdr -= refund.amount_idr;
  }

  const paymentMix = new Map<string, { amountIdr: number; orderCount: number }>();
  for (const row of settlementRows) {
    const method = methodLabel(row.method);
    const previous = paymentMix.get(method) ?? { amountIdr: 0, orderCount: 0 };
    paymentMix.set(method, { amountIdr: previous.amountIdr + row.amount_idr, orderCount: previous.orderCount + 1 });
  }

  const daily = new Map<string, ReportDay>();
  for (let index = 0; index < range.days; index += 1) {
    const dayStart = new Date(new Date(range.start).getTime() + index * 24 * 60 * 60 * 1000);
    const key = dateInJakarta(dayStart.toISOString());
    daily.set(key, { date: key, grossRevenueIdr: 0, refundsIdr: 0, netRevenueIdr: 0, paidOrderCount: 0 });
  }
  for (const row of settlementRows) {
    const day = daily.get(dateInJakarta(row.settled_at!));
    if (day) { day.grossRevenueIdr += row.amount_idr; day.netRevenueIdr += row.amount_idr; day.paidOrderCount += 1; }
  }
  for (const refund of validRefunds) {
    const day = daily.get(dateInJakarta(refund.processed_at));
    if (day) { day.refundsIdr += refund.amount_idr; day.netRevenueIdr -= refund.amount_idr; }
  }

  return {
    date: range.date,
    from: range.from,
    to: range.to,
    start: range.start,
    end: range.end,
    grossRevenueIdr,
    refundsIdr,
    netRevenueIdr,
    revenueIdr: netRevenueIdr,
    orderCount: settlementRows.length,
    averageOrderValueIdr: settlementRows.length ? Math.round(netRevenueIdr / settlementRows.length) : 0,
    estimatedCogsIdr,
    paymentFeesIdr,
    estimatedGrossProfitIdr: netRevenueIdr - estimatedCogsIdr - paymentFeesIdr,
    dineInRevenueIdr,
    takeawayRevenueIdr,
    paymentMethodMix: [...paymentMix.entries()].map(([method, values]) => ({ method, ...values })),
    dailyBreakdown: [...daily.values()],
    bestSellers,
    orders: settlementRows.map((row) => {
      const order = relevantOrders.get(row.order_id);
      return {
        orderNumber: order?.order_number ?? row.order_id,
        createdAt: order?.created_at ?? row.settled_at!,
        settledAt: row.settled_at!,
        type: order?.order_type ?? "unknown",
        totalIdr: row.amount_idr - (refundsByPayment.get(row.id) ?? 0),
        estimatedCostIdr: order?.estimated_cost_idr ?? 0,
        status: order?.status ?? "unknown",
      };
    }),
  };
}

export async function getDailyReport(supabase: SupabaseClient, value?: string) {
  const range = jakartaDayRange(value);
  return getReport(supabase, range.from, range.to);
}
