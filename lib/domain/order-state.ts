export type OrderStatus = "draft" | "awaiting_payment" | "paid" | "accepted" | "processing" | "ready" | "completed" | "cancelled" | "refunded";

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  draft: ["awaiting_payment", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["accepted"],
  accepted: ["processing"],
  processing: ["ready"],
  ready: ["completed"],
  completed: [],
  cancelled: [],
  refunded: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus) {
  return ORDER_TRANSITIONS[from]?.includes(to) ?? false;
}

export function isOperationallyPaid(status: OrderStatus) {
  return ["paid", "accepted", "processing", "ready", "completed"].includes(status);
}
