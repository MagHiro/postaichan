import type { QueryResult, QueryResultRow } from "pg";
import { MidtransProviderError } from "./midtrans-client.ts";
import type { PaymentProvider } from "./provider.ts";
import { createRequestId, structuredLog } from "../security/structured-log.ts";

export type RefundOutcome =
  | { ok: true; alreadyApplied: boolean; attemptId: string; paymentStatus: string; refundedAmountIdr: number }
  | { ok: false; code: string; error: string; status: number; retryable: boolean };

type RefundClaim = {
  attempt_id: string;
  amount_idr: number;
  provider_order_id: string;
  provider_transaction_id: string;
  refund_key: string;
  attempt_state: string;
  claim_token: string | null;
  already_confirmed: boolean;
};

export type RefundQuery = <Row extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<Row>>;

export type RefundWorkflowDependencies = { query: RefundQuery; provider: PaymentProvider };

function errorCode(error: unknown) {
  if (error instanceof MidtransProviderError) return `midtrans_${error.kind}${error.statusCode ? `_${error.statusCode}` : ""}`;
  return error instanceof Error ? error.name.toLowerCase().slice(0, 60) : "provider_error";
}

async function confirmIfProviderListsRefund(provider: PaymentProvider, providerOrderId: string, refundKey: string) {
  const status = await provider.getPaymentStatus(providerOrderId);
  return status.refunds?.find((refund) => refund.refundKey === refundKey) ?? null;
}

function confirmedAmountMatches(refund: { amountIdr: number | null }, expected: number) {
  return refund.amountIdr !== null && refund.amountIdr === expected;
}

async function finalize(query: RefundQuery, attemptId: string, claimToken: string, actorId: string): Promise<RefundOutcome> {
  const result = await query<{ payment_status: string; order_status: string; refunded_amount_idr: number; already_applied: boolean }>(
    "select * from public.finalize_payment_refund_attempt($1::uuid, $2::uuid, $3::uuid)",
    [attemptId, claimToken, actorId],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, code: "REFUND_FINALIZE_FAILED", error: "Provider mengonfirmasi refund, tetapi pencatatan lokal belum selesai. Rekonsiliasi sebelum mengulang.", status: 503, retryable: true };
  return { ok: true, alreadyApplied: row.already_applied, attemptId, paymentStatus: row.payment_status, refundedAmountIdr: row.refunded_amount_idr };
}

async function markState(query: RefundQuery, claim: RefundClaim, state: "submitted" | "failed" | "needs_reconciliation", error: unknown, metadata: Record<string, unknown> = {}) {
  if (!claim.claim_token) return;
  await query(
    "select public.set_refund_attempt_state($1::uuid, $2::uuid, $3, $4, $5::jsonb)",
    [claim.attempt_id, claim.claim_token, state, error ? errorCode(error) : null, JSON.stringify(metadata)],
  );
}

export async function processRefundAttemptCore(input: {
  paymentId: string;
  amountIdr: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  requestId?: string;
}, { query, provider }: RefundWorkflowDependencies): Promise<RefundOutcome> {
  const requestId = input.requestId ?? createRequestId();
  const claimed = await query<RefundClaim>(
    "select * from public.claim_payment_refund($1::uuid, $2, $3, $4::uuid, $5::uuid)",
    [input.paymentId, input.amountIdr, input.reason, input.idempotencyKey, input.actorId],
  );
  const attempt = claimed.rows[0];
  if (!attempt) {
    structuredLog("error", "refund_attempt_claim_missing", requestId, { paymentId: input.paymentId });
    return { ok: false, code: "REFUND_ATTEMPT_MISSING", error: "Refund belum dapat diproses.", status: 503, retryable: true };
  }
  structuredLog("info", "refund_attempt_claimed", requestId, { paymentId: input.paymentId, attemptId: attempt.attempt_id, state: attempt.attempt_state });
  if (attempt.already_confirmed) {
    const current = await query<{ status: string; refunded_amount_idr: number }>("select status, refunded_amount_idr from public.payments where id = $1", [input.paymentId]);
    return { ok: true, alreadyApplied: true, attemptId: attempt.attempt_id, paymentStatus: current.rows[0]?.status ?? "refunded", refundedAmountIdr: current.rows[0]?.refunded_amount_idr ?? input.amountIdr };
  }
  if (!attempt.claim_token) return { ok: false, code: "REFUND_IN_PROGRESS", error: "Refund sedang diproses atau menunggu rekonsiliasi. Coba lagi sebentar.", status: 409, retryable: true };
  if (!attempt.provider_transaction_id) {
    await markState(query, attempt, "needs_reconciliation", new Error("provider_transaction_id_missing"));
    return { ok: false, code: "PAYMENT_PROVIDER_TRANSACTION_MISSING", error: "ID transaksi Midtrans belum tersedia. Refund tidak dikirim; lakukan rekonsiliasi pembayaran.", status: 503, retryable: true };
  }

  let listedRefund: { refundKey: string; amountIdr: number | null; createdAt?: Date } | null = null;
  try {
    listedRefund = await confirmIfProviderListsRefund(provider, attempt.provider_order_id, attempt.refund_key);
  } catch (error) {
    await markState(query, attempt, "needs_reconciliation", error);
    structuredLog("warn", "refund_provider_status_unavailable", requestId, { paymentId: input.paymentId, attemptId: attempt.attempt_id, errorCode: errorCode(error) });
    return { ok: false, code: "REFUND_STATUS_UNAVAILABLE", error: "Status refund belum dapat dipastikan. Refund tidak dikirim ulang dengan kunci baru; coba rekonsiliasi lagi.", status: 503, retryable: true };
  }
  if (listedRefund) {
    if (!confirmedAmountMatches(listedRefund, attempt.amount_idr)) {
      await markState(query, attempt, "needs_reconciliation", new Error("provider_refund_amount_mismatch"));
      return { ok: false, code: "REFUND_AMOUNT_MISMATCH", error: "Jumlah refund Midtrans berbeda atau tidak tersedia. Status lokal tidak diubah; perlu pemeriksaan manual.", status: 409, retryable: false };
    }
    return finalize(query, attempt.attempt_id, attempt.claim_token, input.actorId);
  }

  try {
    const sent = await provider.refundPayment(attempt.provider_transaction_id, attempt.amount_idr, attempt.refund_key);
    await markState(query, attempt, "submitted", null, { providerResponse: sent.duplicate ? "duplicate_key" : "accepted" });
    structuredLog("info", "refund_provider_request_submitted", requestId, { paymentId: input.paymentId, attemptId: attempt.attempt_id, duplicateKey: sent.duplicate });
  } catch (error) {
    const definitive = error instanceof MidtransProviderError && error.kind === "rejected" && error.statusCode !== 409;
    await markState(query, attempt, definitive ? "failed" : "needs_reconciliation", error);
    structuredLog(definitive ? "error" : "warn", "refund_provider_request_uncertain", requestId, { paymentId: input.paymentId, attemptId: attempt.attempt_id, errorCode: errorCode(error) });
    return definitive
      ? { ok: false, code: "REFUND_PROVIDER_REJECTED", error: "Midtrans menolak refund. Percobaan ini dapat diulang dengan kunci yang sama setelah diperiksa.", status: 502, retryable: false }
      : { ok: false, code: "REFUND_NEEDS_RECONCILIATION", error: "Midtrans belum memastikan hasil refund. Gunakan rekonsiliasi sebelum mengulangi.", status: 503, retryable: true };
  }

  try {
    listedRefund = await confirmIfProviderListsRefund(provider, attempt.provider_order_id, attempt.refund_key);
  } catch (error) {
    await markState(query, attempt, "needs_reconciliation", error);
  }
  if (listedRefund) {
    if (!confirmedAmountMatches(listedRefund, attempt.amount_idr)) {
      await markState(query, attempt, "needs_reconciliation", new Error("provider_refund_amount_mismatch"));
      return { ok: false, code: "REFUND_AMOUNT_MISMATCH", error: "Jumlah refund Midtrans berbeda atau tidak tersedia. Status lokal tidak diubah; perlu pemeriksaan manual.", status: 409, retryable: false };
    }
    return finalize(query, attempt.attempt_id, attempt.claim_token, input.actorId);
  }
  await markState(query, attempt, "needs_reconciliation", null, { providerResponse: "submitted_not_yet_visible_in_status" });
  structuredLog("warn", "refund_needs_reconciliation", requestId, { paymentId: input.paymentId, attemptId: attempt.attempt_id });
  return { ok: false, code: "REFUND_NEEDS_RECONCILIATION", error: "Midtrans menerima permintaan refund tetapi statusnya belum muncul. Jangan kirim refund baru; rekonsiliasi status yang sama.", status: 503, retryable: true };
}

export async function reconcileRefundAttemptCore(attemptId: string, actorId: string, { query, provider }: RefundWorkflowDependencies, requestId: string = createRequestId()): Promise<RefundOutcome> {
  const result = await query<{
    payment_id: string; amount_idr: number; refund_key: string; provider_order_id: string;
    idempotency_key: string; reason: string; attempt_actor_id: string; state: string;
  }>(
    `select ra.payment_id, ra.amount_idr, ra.refund_key, ra.idempotency_key, ra.reason, ra.actor_id as attempt_actor_id, ra.state, p.provider_order_id
     from public.refund_attempts ra join public.payments p on p.id = ra.payment_id where ra.id = $1`,
    [attemptId],
  );
  const attempt = result.rows[0];
  if (!attempt) return { ok: false, code: "REFUND_ATTEMPT_NOT_FOUND", error: "Percobaan refund tidak ditemukan.", status: 404, retryable: false };
  if (attempt.state === "confirmed") {
    const current = await query<{ status: string; refunded_amount_idr: number }>("select status, refunded_amount_idr from public.payments where id = $1", [attempt.payment_id]);
    return { ok: true, alreadyApplied: true, attemptId, paymentStatus: current.rows[0]?.status ?? "refunded", refundedAmountIdr: current.rows[0]?.refunded_amount_idr ?? 0 };
  }
  try {
    const refund = await confirmIfProviderListsRefund(provider, attempt.provider_order_id, attempt.refund_key);
    if (!refund) return { ok: false, code: "REFUND_NOT_CONFIRMED", error: "Midtrans belum mencantumkan refund ini. Status lokal tidak diubah.", status: 409, retryable: true };
    if (!confirmedAmountMatches(refund, attempt.amount_idr)) return { ok: false, code: "REFUND_AMOUNT_MISMATCH", error: "Jumlah refund Midtrans berbeda atau tidak tersedia. Status lokal tidak diubah; perlu pemeriksaan manual.", status: 409, retryable: false };
    const claim = await query<RefundClaim>("select * from public.claim_payment_refund($1::uuid, $2, $3, $4::uuid, $5::uuid)", [attempt.payment_id, attempt.amount_idr, attempt.reason, attempt.idempotency_key, actorId]);
    const claimRow = claim.rows[0];
    if (!claimRow?.claim_token && !claimRow?.already_confirmed) return { ok: false, code: "REFUND_IN_PROGRESS", error: "Refund sedang dicatat oleh proses lain. Coba lagi.", status: 409, retryable: true };
    if (claimRow.already_confirmed) {
      const current = await query<{ status: string; refunded_amount_idr: number }>("select status, refunded_amount_idr from public.payments where id = $1", [attempt.payment_id]);
      return { ok: true, alreadyApplied: true, attemptId, paymentStatus: current.rows[0]?.status ?? "refunded", refundedAmountIdr: current.rows[0]?.refunded_amount_idr ?? attempt.amount_idr };
    }
    structuredLog("info", "refund_attempt_reconciled", requestId, { paymentId: attempt.payment_id, attemptId, state: "provider_confirmed" });
    return finalize(query, attemptId, claimRow.claim_token!, actorId);
  } catch (error) {
    structuredLog("warn", "refund_reconciliation_failed", requestId, { paymentId: attempt.payment_id, attemptId, errorCode: errorCode(error) });
    return { ok: false, code: "REFUND_STATUS_UNAVAILABLE", error: "Status provider belum dapat diperiksa. Coba rekonsiliasi lagi.", status: 503, retryable: true };
  }
}
