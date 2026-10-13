import type { Order } from "./types";

export function indonesianOrderAnnouncement(order: Pick<Order, "number" | "customer" | "table">) {
  const name = order.customer?.trim();
  const table = order.table?.trim();
  return `Pesanan baru${name ? ` atas nama ${name}` : ` nomor ${order.number}`}${table ? `, ${table}` : ", untuk pengambilan di kasir"}.`;
}
