export type PaymentStatus = "pending" | "settled" | "expired" | "failed" | "refunded" | "partially_refunded";

const rank: Record<PaymentStatus, number> = {
  pending: 10,
  failed: 20,
  expired: 20,
  settled: 40,
  partially_refunded: 50,
  refunded: 60,
};

export function canApplyPaymentStatus(current: PaymentStatus, incoming: PaymentStatus) {
  if (current === incoming) return true;
  return rank[incoming] >= rank[current] && !(current === "failed" && incoming === "expired") && !(current === "expired" && incoming === "failed");
}

export function paymentStatusFromProvider(transactionStatus: string, fraudStatus?: string): PaymentStatus {
  if (["settlement", "capture"].includes(transactionStatus) && (!fraudStatus || fraudStatus === "accept")) return "settled";
  if (["expire", "cancel"].includes(transactionStatus)) return "expired";
  if (["deny", "failure"].includes(transactionStatus)) return "failed";
  return "pending";
}
