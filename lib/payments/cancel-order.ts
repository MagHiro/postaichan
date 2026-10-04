import "server-only";
import { query } from "@/lib/db";
import { MidtransProvider, describeMidtransError } from "@/lib/payments/midtrans";
import type { ProviderPaymentStatus } from "@/lib/payments/provider";
import { providerStateBeforeCancellation } from "@/lib/payments/provider-cancellation";
import { synchronizeProviderPaymentState } from "@/lib/payments/synchronize-provider-state";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

type CancellationRequest = { orderId: string; sessionHash?: string; actorId?: string; requestId?: string };
export type CancellationOutcome =
  | { ok: true; paymentStatus: string | null }
  | { ok: false; code: string; error: string; status: number; retryable?: boolean };

export async function cancelOrderWithProvider(input: CancellationRequest): Promise<CancellationOutcome> {
  const requestId = input.requestId ?? createRequestId();
  const orderResult = await query<{
    order_status: string;
    has_settled_payment: boolean;
  }>(
    `select o.status as order_status,
            exists (select 1 from public.payments paid where paid.order_id = o.id and paid.status in ('settled','partially_refunded','refunded')) as has_settled_payment
     from public.orders o
     ${input.sessionHash ? "join public.customer_sessions cs on cs.id = o.customer_session_id" : ""}
     where o.id = $1 ${input.sessionHash ? "and cs.access_token_hash = $2 and cs.expires_at > timezone('utc', now())" : ""}`,
    input.sessionHash ? [input.orderId, input.sessionHash] : [input.orderId],
  );
  const order = orderResult.rows[0];
  if (!order) return { ok: false, code: "ORDER_NOT_FOUND", error: "Pesanan tidak ditemukan atau sesi pemesanan sudah berakhir.", status: 404 };
  if (!(["draft", "awaiting_payment"].includes(order.order_status))) return { ok: false, code: "ORDER_CANNOT_CANCEL", error: `Pesanan berstatus ${order.order_status.replace(/_/g, " ")} dan tidak dapat dibatalkan.`, status: 409 };
  if (order.has_settled_payment) return { ok: false, code: "ORDER_CANNOT_CANCEL", error: "Pembayaran sudah diterima. Pesanan tidak dibatalkan; gunakan proses refund atau rekonsiliasi.", status: 409 };

  const pendingPayments = await query<{ id: string; provider: string; provider_order_id: string }>(
    "select id, provider, provider_order_id from public.payments where order_id = $1 and status = 'pending' order by created_at",
    [input.orderId],
  );
  if (pendingPayments.rows.length) {
    try {
      const provider = new MidtransProvider();
      const verified: Array<{ paymentId: string; status: ProviderPaymentStatus }> = [];
      for (const payment of pendingPayments.rows) {
        if (payment.provider !== "midtrans" || !payment.provider_order_id) {
          return { ok: false, code: "ORDER_CANCEL_PROVIDER_UNCONFIRMED", error: "Status pembayaran belum dapat dipastikan. Pesanan dan stok tetap tidak berubah; coba lagi sebentar.", status: 503, retryable: true };
        }
        const providerState = await providerStateBeforeCancellation(provider, payment.provider_order_id);
        if (!["settled", "refunded", "partially_refunded", "expired", "failed"].includes(providerState.state)) {
          return { ok: false, code: "ORDER_CANCEL_PROVIDER_UNCONFIRMED", error: "Status QR belum dapat dipastikan. Pesanan dan stok tetap tidak berubah; coba lagi sebentar.", status: 503, retryable: true };
        }
        verified.push({ paymentId: payment.id, status: providerState });
      }
      for (const item of verified) await synchronizeProviderPaymentState(item.paymentId, item.status);
      if (verified.some(({ status }) => ["settled", "refunded", "partially_refunded"].includes(status.state))) {
        return { ok: false, code: "ORDER_PAYMENT_ALREADY_SETTLED", error: "Midtrans sudah menerima pembayaran. Pesanan tidak dibatalkan; periksa pesanan atau mulai refund.", status: 409 };
      }
    } catch (error) {
      const failure = describeMidtransError(error);
      structuredLog("warn", "order_cancel_provider_status_unavailable", requestId, {
        orderId: input.orderId,
        providerErrorCode: failure?.code ?? (error instanceof Error ? error.name : "unknown"),
      });
      return { ok: false, code: "ORDER_CANCEL_PROVIDER_UNCONFIRMED", error: "Status QR belum dapat dipastikan. Pesanan dan stok tetap tidak berubah; coba lagi sebentar.", status: 503, retryable: true };
    }
  }

  const cancelled = await query<{ cancelled: boolean; order_status: string; payment_status: string | null }>(
    "select * from public.cancel_order($1::uuid, $2, $3::uuid)",
    [input.orderId, input.sessionHash ?? null, input.actorId ?? null],
  );
  const row = cancelled.rows[0];
  if (!row?.cancelled) {
    structuredLog("warn", "order_cancel_conflict", requestId, { orderId: input.orderId, paymentStatus: row?.payment_status ?? "unknown" });
    return { ok: false, code: "ORDER_STATE_CHANGED", error: row?.payment_status && ["settled", "partially_refunded", "refunded"].includes(row.payment_status) ? "Midtrans sudah menerima pembayaran. Pesanan tidak dibatalkan; periksa pesanan atau mulai refund." : "Pesanan berubah saat pembatalan. Muat ulang status lalu coba lagi.", status: 409 };
  }
  structuredLog("info", "order_cancelled", requestId, { orderId: input.orderId, paymentStatus: row.payment_status ?? "none" });
  return { ok: true, paymentStatus: row.payment_status };
}
