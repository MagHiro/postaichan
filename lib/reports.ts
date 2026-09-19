
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

export async function getReport(fromValue?: string, toValue?: string): Promise<DailyReport> {
  const { query } = await import("@/lib/db");
  const range = jakartaRange(fromValue, toValue);
  const candidatePayments = await query<PaymentRow & { method: string }>(
    `select id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at, method
     from public.payments
     where status = any($1::public.payment_status[])
       and orphaned_settlement = false
       and settled_at is not null
       and settled_at >= $2 and settled_at < $3
     order by settled_at asc`,
    [RECOGNIZED_PAYMENT_STATUSES, range.start, range.end],
  );
  const candidateRows = candidatePayments.rows;
  const candidateOrderIds = [...new Set(candidateRows.map((row) => row.order_id))];
  const allOrderPayments = candidateOrderIds.length
    ? await query<PaymentRow & { method: string }>(
      `select id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at, method
       from public.payments
       where order_id = any($1::uuid[]) and status = any($2::public.payment_status[]) and settled_at is not null
       order by settled_at asc`,
      [candidateOrderIds, RECOGNIZED_PAYMENT_STATUSES],
    )
    : { rows: [] as Array<PaymentRow & { method: string }> };

  const primaryByOrder = new Map<string, PaymentRow & { method: string }>();
  for (const row of allOrderPayments.rows) {
    if (row.orphaned_settlement !== true && row.settled_at && !primaryByOrder.has(row.order_id)) primaryByOrder.set(row.order_id, row);
  }
  const settlementRows = [...primaryByOrder.values()].filter((row) => row.settled_at! >= range.start && row.settled_at! < range.end);
  const settlementPaymentIds = settlementRows.map((row) => row.id);

  const [refunds, orders] = await Promise.all([
    query<RefundRow>(
      `select id, payment_id, amount_idr, processed_at, reason
       from public.payment_refunds where processed_at >= $1 and processed_at < $2 order by processed_at asc`,
      [range.start, range.end],
    ),
    candidateOrderIds.length
      ? query<OrderRow>("select id, order_number, order_type, status, total_idr, estimated_cost_idr, created_at from public.orders where id = any($1::uuid[])", [candidateOrderIds])
      : Promise.resolve({ rows: [] as OrderRow[] }),
  ]);

  const refundRows = refunds.rows;
  const refundPaymentIds = [...new Set(refundRows.map((row) => row.payment_id))];
  const extraPaymentIds = refundPaymentIds.filter((id) => !settlementPaymentIds.includes(id));
  const refundPayments = extraPaymentIds.length
    ? await query<PaymentRow & { method: string }>("select id, order_id, status, amount_idr, fee_idr, refunded_amount_idr, orphaned_settlement, settled_at, created_at, method from public.payments where id = any($1::uuid[])", [extraPaymentIds])
    : { rows: [] as Array<PaymentRow & { method: string }> };

  const paymentById = new Map<string, PaymentRow & { method: string }>();
  for (const row of settlementRows) paymentById.set(row.id, row);
  for (const row of refundPayments.rows) paymentById.set(row.id, row);
  const validRefunds = refundRows.filter((row) => {
    const payment = paymentById.get(row.payment_id);
    return payment && payment.orphaned_settlement !== true && RECOGNIZED_PAYMENT_STATUSES.includes(payment.status as (typeof RECOGNIZED_PAYMENT_STATUSES)[number]);
  });

  const allRelevantOrderIds = [...new Set([...settlementRows.map((row) => row.order_id), ...validRefunds.map((row) => paymentById.get(row.payment_id)?.order_id).filter((id): id is string => Boolean(id))])];
  const relevantOrders = new Map(orders.rows.map((order) => [order.id, order]));
  const missingOrderIds = allRelevantOrderIds.filter((id) => !relevantOrders.has(id));
  if (missingOrderIds.length) {
    const extraOrders = await query<OrderRow>("select id, order_number, order_type, status, total_idr, estimated_cost_idr, created_at from public.orders where id = any($1::uuid[])", [missingOrderIds]);
    for (const order of extraOrders.rows) relevantOrders.set(order.id, order);
  }
  const items = allRelevantOrderIds.length
    ? await query<ItemRow>("select order_id, product_name_snapshot, quantity, line_total_idr, unit_cost_snapshot_idr from public.order_items where order_id = any($1::uuid[])", [allRelevantOrderIds])
    : { rows: [] as ItemRow[] };
  const itemRows = items.rows;

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

export async function getDailyReport(value?: string) {
  const range = jakartaDayRange(value);
  return getReport(range.from, range.to);
}
