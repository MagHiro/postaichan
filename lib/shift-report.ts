import { query } from "@/lib/db";
import { netRecognizedPayment } from "@/lib/reports";

type PaymentRow = {
  id: string;
  order_id: string;
  status: string;
  method: string;
  amount_idr: number;
  refunded_amount_idr?: number | null;
  orphaned_settlement?: boolean | null;
  settled_at?: string | null;
};

type RefundRow = { payment_id: string; amount_idr: number };
type ItemAggregate = { product_id: string | null; name: string; quantity: number; revenueIdr: number };

export type ShiftSummary = {
  shiftId: string;
  grossRevenueIdr: number;
  refundsIdr: number;
  netRevenueIdr: number;
  orderCount: number;
  cashRevenueIdr: number;
  qrisRevenueIdr: number;
  itemsSold: number;
  products: ItemAggregate[];
};

function isCash(method?: string | null) {
  return (method ?? "").toLowerCase() === "cash";
}

/**
 * Scope-aware sales recap. When shiftId is given the anchor is the shift's
 * lifespan (opened_at → closed_at or now); otherwise the anchor is the
 * currently open shift, and null when the register is closed.
 *
 * A payment row is included exactly once (first valid primary per order),
 * net is clamped per payment, and orders whose status contradicts a valid
 * settlement (cancelled/draft) are dropped fail-closed and logged.
 */
export async function getShiftSummary(shiftId?: string): Promise<ShiftSummary | null> {
  const shift = shiftId
    ? (await query<{ id: string; opened_at: string; closed_at: string | null }>("select id, opened_at, closed_at from public.cashier_shifts where id = $1", [shiftId])).rows[0]
    : (await query<{ id: string; opened_at: string; closed_at: string | null }>("select id, opened_at, closed_at from public.cashier_shifts where closed_at is null order by opened_at desc limit 1")).rows[0];
  if (!shift) return null;
  const start = shift.opened_at;
  const end = shift.closed_at ?? new Date().toISOString();

  const payments = await query<PaymentRow>(
    `select p.id, p.order_id, p.status, p.method, p.amount_idr, p.refunded_amount_idr, p.orphaned_settlement, p.settled_at
     from public.payments p
     join public.orders o on o.id = p.order_id
     where o.shift_id = $1 and p.settled_at >= $2 and (p.settled_at < $3 or $4::boolean)
     order by p.settled_at asc`,
    [shift.id, start, end, shift.closed_at === null],
  );

  const primaryByOrder = new Map<string, PaymentRow>();
  for (const row of payments.rows) {
    if (row.orphaned_settlement === true || !row.settled_at) continue;
    if (!primaryByOrder.has(row.order_id)) primaryByOrder.set(row.order_id, row);
  }
  const primaries = [...primaryByOrder.values()];
  if (!primaries.length) {
    return { shiftId: shift.id, grossRevenueIdr: 0, refundsIdr: 0, netRevenueIdr: 0, orderCount: 0, cashRevenueIdr: 0, qrisRevenueIdr: 0, itemsSold: 0, products: [] };
  }

  const orderIds = [...new Set(primaries.map((row) => row.order_id))];
  const [orders, refunds, items] = await Promise.all([
    query<{ id: string; order_number: string; status: string }>("select id, order_number, status from public.orders where id = any($1::uuid[])", [orderIds]),
    query<RefundRow>("select payment_id, amount_idr from public.payment_refunds where payment_id = any($1::uuid[])", [primaries.map((row) => row.id)]),
    query<{ order_id: string; product_id: string | null; product_name_snapshot: string; quantity: number; line_total_idr: number }>(
      "select order_id, product_id, product_name_snapshot, quantity, line_total_idr from public.order_items where order_id = any($1::uuid[])",
      [orderIds],
    ),
  ]);
  const orderById = new Map(orders.rows.map((order) => [order.id, order]));
  const refundsByPayment = new Map<string, number>();
  for (const refund of refunds.rows) refundsByPayment.set(refund.payment_id, (refundsByPayment.get(refund.payment_id) ?? 0) + refund.amount_idr);

  const valid = primaries.filter((row) => {
    const order = orderById.get(row.order_id);
    const ok = order !== undefined && order.status !== "cancelled" && order.status !== "draft";
    if (!ok) console.error("shift_report_dropped_row", { paymentId: row.id, orderId: row.order_id, orderStatus: order?.status ?? "missing" });
    return ok;
  });

  let grossRevenueIdr = 0;
  let refundsIdr = 0;
  let netRevenueIdr = 0;
  let cashRevenueIdr = 0;
  let qrisRevenueIdr = 0;
  for (const row of valid) {
    const net = netRecognizedPayment(row);
    const refundTotal = Math.min(refundsByPayment.get(row.id) ?? 0, row.amount_idr);
    grossRevenueIdr += row.amount_idr;
    refundsIdr += refundTotal;
    netRevenueIdr += net;
    if (isCash(row.method)) cashRevenueIdr += net;
    else qrisRevenueIdr += net;
  }

  const validOrderIds = new Set(valid.map((row) => row.order_id));
  const byProduct = new Map<string, ItemAggregate>();
  let itemsSold = 0;
  for (const item of items.rows) {
    if (!validOrderIds.has(item.order_id)) continue;
    itemsSold += item.quantity;
    const key = item.product_id ?? `name:${item.product_name_snapshot}`;
    const previous = byProduct.get(key) ?? { product_id: item.product_id, name: item.product_name_snapshot, quantity: 0, revenueIdr: 0 };
    previous.quantity += item.quantity;
    previous.revenueIdr += item.line_total_idr;
    byProduct.set(key, previous);
  }
  const products = [...byProduct.values()].sort((a, b) => b.quantity - a.quantity || b.revenueIdr - a.revenueIdr);

  return { shiftId: shift.id, grossRevenueIdr, refundsIdr, netRevenueIdr, orderCount: valid.length, cashRevenueIdr, qrisRevenueIdr, itemsSold, products };
}

export type CloseRecap = ShiftSummary & {
  openedAt: string;
  pendingCount: number;
  remaining: Array<{ productId: string; name: string; openingQuantity: number; soldQuantity: number; remainingQuantity: number }>;
};

/** Full close recap: summary plus per-product sold vs remaining for tracked stock. */
export async function getCloseRecap(): Promise<CloseRecap | null> {
  const shift = (await query<{ id: string; opened_at: string }>("select id, opened_at from public.cashier_shifts where closed_at is null order by opened_at desc limit 1")).rows[0];
  if (!shift) return null;
  const summary = (await getShiftSummary(shift.id)) ?? { shiftId: shift.id, grossRevenueIdr: 0, refundsIdr: 0, netRevenueIdr: 0, orderCount: 0, cashRevenueIdr: 0, qrisRevenueIdr: 0, itemsSold: 0, products: [] };
  const pending = await query<{ count: string }>("select count(*) as count from public.payments where status = 'pending' and expires_at > timezone('utc', now())");
  const intake = await query<{ product_id: string; name: string; opening_quantity: number; stock_quantity: number }>(
    `select i.product_id, p.name, i.opening_quantity, p.stock_quantity
     from public.shift_stock_intakes i join public.products p on p.id = i.product_id
     where i.shift_id = $1 order by p.name asc`,
    [shift.id],
  );
  const soldByProduct = new Map<string, number>();
  for (const product of summary.products) {
    if (product.product_id) soldByProduct.set(product.product_id, (soldByProduct.get(product.product_id) ?? 0) + product.quantity);
  }
  return {
    ...summary,
    openedAt: shift.opened_at,
    pendingCount: Number(pending.rows[0]?.count ?? 0),
    remaining: intake.rows.map((row) => ({
      productId: row.product_id,
      name: row.name,
      openingQuantity: row.opening_quantity,
      soldQuantity: soldByProduct.get(row.product_id) ?? 0,
      remainingQuantity: row.stock_quantity,
    })),
  };
}
