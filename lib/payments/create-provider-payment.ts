import "server-only";
import { query } from "@/lib/db";
import { describeMidtransError, MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import type { CreatePaymentResult, ProviderPaymentStatus } from "@/lib/payments/provider";
import { providerStateBeforeCancellation } from "@/lib/payments/provider-cancellation";
import { synchronizeProviderPaymentState } from "@/lib/payments/synchronize-provider-state";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

const MINIMUM_WINDOW_MS = 60_000;

export type PaymentIntent = {
  order_id: string;
  order_number: string;
  payment_id: string;
  payment_status: string;
  amount_idr: number;
  provider_order_id: string;
  qr_string: string | null;
  created_at: string | Date | null;
  expires_at: string | Date | null;
};

export type ProviderPaymentOutcome =
  | { ok: true; qrString: string | null; qrImageUrl: string | null; expiresAt: string | null }
  | { ok: false; code: string; error: string; status: number; retryable: boolean; action?: string };

function databaseDate(value: string | Date | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function errorCode(error: unknown) {
  const described = describeMidtransError(error);
  if (described) return described.code;
  return error instanceof Error ? error.message.split(":")[0].slice(0, 80) : "provider_error";
}

async function reverseCreatedTransaction(provider: MidtransProvider, paymentId: string, providerOrderId: string, claimToken: string, transactionId?: string) {
  let status: ProviderPaymentStatus | null = null;
  try {
    const result = await provider.expirePayment(providerOrderId);
    if (result.outcome === "status_required") status = await provider.getPaymentStatus(providerOrderId);
    else status = { state: "expired", providerStatus: "expire", providerTransactionId: transactionId };
  } catch {
    try { status = await provider.getPaymentStatus(providerOrderId); } catch { status = null; }
  }
  if (status) await synchronizeProviderPaymentState(paymentId, status).catch(() => undefined);
  if (!status || !["expired", "failed"].includes(status.state)) {
    const alertKey = `provider-create-race:${paymentId}:${claimToken}`;
    await query("select public.record_provider_reconciliation_alert($1, $2::uuid, $3, $4::jsonb)", [alertKey, paymentId, "provider_create_finalize_lost", JSON.stringify({ providerOrderId, providerTransactionId: status?.providerTransactionId ?? transactionId ?? null, providerStatus: status?.providerStatus ?? "unavailable", providerState: status?.state ?? "unknown" })]).catch(() => undefined);
  }
}

async function reconcilePriorCreate(paymentId: string, providerOrderId: string, provider: MidtransProvider, requestId: string) {
  const unresolved = await query<{ alert_type: string }>(
    `select alert_type from public.provider_reconciliation_alerts
     where payment_id = $1 and state = 'unresolved'
       and alert_type in ('provider_create_outcome_unknown','provider_create_finalize_lost')
     order by created_at desc limit 1`,
    [paymentId],
  );
  if (!unresolved.rows[0]) return null;
  try {
    const status = await providerStateBeforeCancellation(provider, providerOrderId);
    await synchronizeProviderPaymentState(paymentId, status);
    if (["settled", "refunded", "partially_refunded"].includes(status.state)) {
      return { ok: false as const, code: "PAYMENT_PROVIDER_ALREADY_SETTLED", error: "Midtrans telah mengubah status pembayaran. Muat ulang pesanan sebelum melanjutkan.", status: 409, retryable: false, action: "refresh_order" };
    }
    if (["expired", "failed"].includes(status.state)) {
      return { ok: false as const, code: "PAYMENT_PROVIDER_ATTEMPT_EXPIRED", error: "Percobaan pembayaran provider sudah berakhir. Buat percobaan pembayaran baru.", status: 409, retryable: false, action: "retry_checkout" };
    }
    structuredLog("warn", "provider_create_retry_state_unconfirmed", requestId, { paymentId, providerState: status.state });
    return { ok: false as const, code: "PAYMENT_PROVIDER_RECONCILIATION_PENDING", error: "Status percobaan sebelumnya belum dapat dipastikan. QR tidak dibuat ulang; coba rekonsiliasi lagi.", status: 503, retryable: true, action: "retry" };
  } catch (error) {
    structuredLog("warn", "provider_create_retry_status_unavailable", requestId, { paymentId, errorType: error instanceof Error ? error.name : "unknown" });
    return { ok: false as const, code: "PAYMENT_PROVIDER_RECONCILIATION_PENDING", error: "Status percobaan sebelumnya belum dapat dipastikan. QR tidak dibuat ulang; coba lagi sebentar.", status: 503, retryable: true, action: "retry" };
  }
}

export async function createProviderPayment(intent: PaymentIntent, requestId = createRequestId()): Promise<ProviderPaymentOutcome> {
  const provider = new MidtransProvider();
  const current = await query<{ status: string; qr_string: string | null; created_at: Date | string; expires_at: Date | string | null; provider_order_id: string; amount_idr: number }>(
    "select status, qr_string, created_at, expires_at, provider_order_id, amount_idr from public.payments where id = $1",
    [intent.payment_id],
  );
  const payment = current.rows[0];
  if (!payment) return { ok: false, code: "PAYMENT_NOT_FOUND", error: "Pembayaran tidak ditemukan.", status: 404, retryable: false };
  if (payment.status !== "pending") return { ok: false, code: "PAYMENT_NOT_PENDING", error: "Pembayaran sudah tidak menunggu QR.", status: 409, retryable: false };
  const { qrString, qrImageUrl } = presentQrMaterial(payment.qr_string);
  if (qrString || qrImageUrl) return { ok: true, qrString: qrString ?? null, qrImageUrl: qrImageUrl ?? null, expiresAt: payment.expires_at ? new Date(payment.expires_at).toISOString() : null };

  const createdAt = databaseDate(payment.created_at);
  const expiresAt = databaseDate(payment.expires_at);
  if (!createdAt || !expiresAt) return { ok: false, code: "PAYMENT_EXPIRY_MISSING", error: "Waktu berlaku pembayaran tidak tersedia. Buat percobaan pembayaran baru.", status: 409, retryable: false };

  const previousOutcome = await reconcilePriorCreate(intent.payment_id, payment.provider_order_id, provider, requestId);
  if (previousOutcome) return previousOutcome;

  const claimResult = await query<{ claimed: boolean; claim_token: string | null; expired: boolean }>(
    "select * from public.claim_payment_provider_create($1::uuid)", [intent.payment_id],
  );
  const claim = claimResult.rows[0];
  if (claim?.expired) return { ok: false, code: "PAYMENT_WINDOW_EXPIRED", error: "Waktu pembayaran hampir habis. Buat percobaan pembayaran baru.", status: 409, retryable: false, action: "retry_checkout" };
  if (!claim?.claimed || !claim.claim_token) {
    const reconciled = await reconcilePriorCreate(intent.payment_id, payment.provider_order_id, provider, requestId);
    return reconciled ?? { ok: false, code: "PAYMENT_PREPARING", error: "Pembayaran sedang disiapkan. Coba lagi dalam beberapa detik.", status: 503, retryable: true, action: "retry" };
  }

  let createdPayment: CreatePaymentResult | null = null;
  try {
    if (expiresAt.getTime() - Date.now() < MINIMUM_WINDOW_MS) {
      await query("select public.release_payment_provider_create($1::uuid, $2::uuid, $3, false)", [intent.payment_id, claim.claim_token, "expiry_window_too_short"]);
      const expiredResult = await query<{ expired: boolean }>("select (expires_at <= timezone('utc', now()) + interval '60 seconds') as expired from public.payments where id = $1", [intent.payment_id]);
      if (expiredResult.rows[0]?.expired) await query("select public.claim_payment_provider_create($1::uuid)", [intent.payment_id]);
      return { ok: false, code: "PAYMENT_WINDOW_TOO_SHORT", error: "Waktu pembayaran hampir habis. Buat percobaan pembayaran baru.", status: 409, retryable: false, action: "retry_checkout" };
    }
    const started = await query<{ started: boolean }>("select public.mark_payment_provider_create_submitted($1::uuid, $2::uuid) as started", [intent.payment_id, claim.claim_token]);
    if (started.rows[0]?.started !== true) return { ok: false, code: "PAYMENT_STATE_CHANGED", error: "Pesanan berubah sebelum QR dapat dibuat. Muat ulang status pesanan.", status: 409, retryable: false, action: "refresh_order" };
    const created = createdPayment = await provider.createPayment({ providerOrderId: payment.provider_order_id, amountIdr: payment.amount_idr, createdAt, expiresAt });
    const material = created.qrString ?? created.qrImageUrl;
    const finalized = await query<{ finalized: boolean }>(
      "select public.finalize_payment_provider_create($1::uuid, $2::uuid, $3, $4, $5::timestamptz) as finalized",
      [intent.payment_id, claim.claim_token, created.providerTransactionId ?? null, material ?? null, created.providerExpiresAt?.toISOString() ?? null],
    );
    if (finalized.rows[0]?.finalized !== true) {
      await reverseCreatedTransaction(provider, intent.payment_id, payment.provider_order_id, claim.claim_token, created.providerTransactionId);
      structuredLog("warn", "provider_payment_finalize_conflict", requestId, { paymentId: intent.payment_id });
      return { ok: false, code: "PAYMENT_FINALIZE_CONFLICT", error: "Pesanan berubah saat QR dibuat. QR tersebut tidak dapat digunakan; periksa status pesanan sebelum mencoba lagi.", status: 409, retryable: true, action: "refresh_order" };
    }
    const storedExpiry = await query<{ expires_at: Date | string }>("select expires_at from public.payments where id = $1", [intent.payment_id]);
    const effectiveExpiry = storedExpiry.rows[0]?.expires_at ? new Date(storedExpiry.rows[0].expires_at).toISOString() : expiresAt.toISOString();
    return { ok: true, qrString: created.qrString ?? null, qrImageUrl: created.qrImageUrl ?? null, expiresAt: effectiveExpiry };
  } catch (error) {
    if (createdPayment) {
      // The provider accepted the charge request, but local finalization (or
      // reading its committed expiry) failed. Never return the QR; try to
      // reverse it and persist its verified outcome before reporting failure.
      await reverseCreatedTransaction(provider, intent.payment_id, payment.provider_order_id, claim.claim_token, createdPayment.providerTransactionId);
      structuredLog("error", "provider_payment_finalize_unconfirmed", requestId, { paymentId: intent.payment_id, errorType: error instanceof Error ? error.name : "unknown" });
      return { ok: false, code: "PAYMENT_FINALIZE_CONFLICT", error: "QR provider dibuat, tetapi status lokal belum dapat dipastikan. QR tidak ditampilkan; periksa status pesanan sebelum mencoba lagi.", status: 503, retryable: true, action: "refresh_order" };
    }
    const failure = describeMidtransError(error);
    const definitive = error instanceof Error && error.name === "MidtransProviderError" && (error as { kind?: string }).kind === "rejected";
    if (definitive) {
      await query("select public.release_payment_provider_create($1::uuid, $2::uuid, $3, true)", [intent.payment_id, claim.claim_token, errorCode(error)]).catch(() => undefined);
    } else {
      // Keep the submitted marker and claim when the provider outcome is
      // uncertain. A later claimant will create a durable reconciliation alert
      // before it can ever attempt another charge.
      const alertKey = `provider-create-unknown:${intent.payment_id}:${claim.claim_token}`;
      await query("select public.record_provider_reconciliation_alert($1, $2::uuid, $3, $4::jsonb)", [alertKey, intent.payment_id, "provider_create_outcome_unknown", JSON.stringify({ providerOrderId: payment.provider_order_id, errorCode: errorCode(error) })]).catch(() => undefined);
    }
    structuredLog("error", "provider_payment_create_failed", requestId, { paymentId: intent.payment_id, errorCode: errorCode(error), definitive });
    return failure
      ? { code: failure.code, error: failure.error, status: failure.status, retryable: failure.retryable, ok: false }
      : { code: "PAYMENT_PROVIDER_UNAVAILABLE", error: "QR pembayaran belum dapat dibuat. Status pembayaran sedang diperiksa; coba lagi sebentar.", status: 503, retryable: true, ok: false };
  }
}
