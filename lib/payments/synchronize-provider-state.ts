import "server-only";
import { query } from "@/lib/db";
import type { ProviderPaymentStatus } from "@/lib/payments/provider";

/** Apply only provider states that were obtained from a verified status lookup. */
export async function synchronizeProviderPaymentState(paymentId: string, status: ProviderPaymentStatus) {
  if (["settled", "refunded", "partially_refunded"].includes(status.state)) {
    await query(
      "select * from public.apply_payment_transition($1::uuid, 'settled'::public.payment_status, $2, $3, 0, $4::timestamptz)",
      [paymentId, status.providerStatus, status.providerTransactionId ?? null, status.settlementTime?.toISOString() ?? new Date().toISOString()],
    );
    if (status.state === "refunded" || status.state === "partially_refunded") {
      await query(
        "select public.mark_provider_refund_notification($1::uuid, $2, $3::jsonb)",
        [paymentId, status.providerStatus, JSON.stringify({ refundKeys: status.refundKeys ?? [], refunds: status.refunds ?? [], refundAmountIdr: status.refundAmountIdr ?? null })],
      );
    }
    return;
  }
  const nextStatus = status.state === "expired" ? "expired" : status.state === "failed" ? "failed" : null;
  if (nextStatus) {
    await query(
      "select * from public.apply_payment_transition($1::uuid, $2::public.payment_status, $3, $4, 0, null)",
      [paymentId, nextStatus, status.providerStatus, status.providerTransactionId ?? null],
    );
  }
}
