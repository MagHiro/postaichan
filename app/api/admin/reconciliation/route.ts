import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { query } from "@/lib/db";
import { reconcileRefundAttempt, processRefundAttempt } from "@/lib/payments/refund-workflow";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { providerStateBeforeCancellation } from "@/lib/payments/provider-cancellation";
import { synchronizeProviderPaymentState } from "@/lib/payments/synchronize-provider-state";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

export const runtime = "nodejs";

const uuid = z.string().uuid();
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept_settlement"), paymentId: uuid, reason: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("refund_settlement"), paymentId: uuid, amountIdr: z.number().int().positive().max(2_000_000_000), reason: z.string().trim().min(3).max(240), idempotencyKey: uuid }).strict(),
  z.object({ action: z.literal("complete_orphaned_refund"), paymentId: uuid, reason: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("reconcile_refund_attempt"), attemptId: uuid }).strict(),
  z.object({ action: z.literal("reconcile_provider_refund"), alertId: uuid, paymentId: uuid, refundKey: z.string().min(1).max(160), amountIdr: z.number().int().positive().max(2_000_000_000), reason: z.string().trim().min(3).max(240) }).strict(),
  z.object({ action: z.literal("reconcile_provider_creation"), alertId: uuid, paymentId: uuid, reason: z.string().trim().min(3).max(240) }).strict(),
]);

function authFailure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

export async function GET() {
  const requestId = createRequestId();
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return authFailure(auth);
  try {
    const [orphaned, attempts, alerts] = await Promise.all([
      query(`select o.order_number, o.status as order_status, p.id as payment_id, p.provider_order_id, p.provider_transaction_id,
                    p.status as payment_status, p.amount_idr, p.refunded_amount_idr, p.settled_at,
                    coalesce(ir.status::text, 'missing') as inventory_state,
                    case when o.status = 'cancelled' then 'Order was cancelled before a verified settlement.'
                         when ir.status is distinct from 'consumed'::public.inventory_reservation_status then 'Inventory was not consumed for this provider-confirmed settlement.'
                         else 'Provider settlement needs explicit operator reconciliation.' end as reason
             from public.payments p join public.orders o on o.id = p.order_id
             left join lateral (select status from public.inventory_reservations where payment_id = p.id order by created_at desc limit 1) ir on true
             where p.orphaned_settlement = true and p.status in ('settled','partially_refunded','refunded') order by p.settled_at asc`),
      query(`select ra.id as attempt_id, ra.payment_id, o.order_number, ra.amount_idr, ra.refund_key, ra.state, ra.last_error_code, ra.updated_at
             from public.refund_attempts ra join public.payments p on p.id = ra.payment_id join public.orders o on o.id = p.order_id
             where ra.state in ('submitted','needs_reconciliation','claimed') order by ra.updated_at asc`),
      query(`select a.id, a.payment_id, o.order_number, a.alert_type, a.details, a.created_at
             from public.provider_reconciliation_alerts a
             left join public.orders o on o.id = a.order_id
             where a.state = 'unresolved' order by a.created_at asc`),
    ]);
    return NextResponse.json({ orphanedSettlements: orphaned.rows, refundAttempts: attempts.rows, alerts: alerts.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "admin_reconciliation_list_failed", requestId, { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Daftar rekonsiliasi belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return authFailure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Data rekonsiliasi tidak valid." }, { status: 400, headers: noStoreHeaders() });

  try {
    const input = parsed.data;
    const entityId = input.action === "reconcile_refund_attempt" ? input.attemptId : input.paymentId;
    await query("select public.record_admin_reconciliation_request($1::uuid, $2, $3::uuid, $4::integer)", [auth.actorId, input.action, entityId, "amountIdr" in input ? input.amountIdr : null]);
    structuredLog("info", "admin_reconciliation_action", requestId, { action: input.action, entityId });
    if (input.action === "accept_settlement") {
      const result = await query("select * from public.reconcile_orphaned_settlement($1::uuid, 'accept', $2::uuid, $3)", [input.paymentId, auth.actorId, input.reason]);
      if (!result.rows[0]?.resolved) return NextResponse.json({ error: "Settlement berubah; muat ulang daftar rekonsiliasi." }, { status: 409, headers: noStoreHeaders() });
      return NextResponse.json({ resolved: true }, { headers: noStoreHeaders() });
    }
    if (input.action === "refund_settlement") {
      const payment = await query<{ amount_idr: number; refunded_amount_idr: number; orphaned_settlement: boolean }>("select amount_idr, refunded_amount_idr, orphaned_settlement from public.payments where id = $1 and status in ('settled','partially_refunded')", [input.paymentId]);
      const row = payment.rows[0];
      if (!row?.orphaned_settlement) return NextResponse.json({ error: "Settlement orphan tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
      const remaining = row.amount_idr - row.refunded_amount_idr;
      if (input.amountIdr !== remaining) return NextResponse.json({ error: "Refund settlement harus mencakup sisa saldo provider secara penuh." }, { status: 409, headers: noStoreHeaders() });
      const result = await processRefundAttempt({ paymentId: input.paymentId, amountIdr: input.amountIdr, reason: input.reason, idempotencyKey: input.idempotencyKey, actorId: auth.actorId!, requestId });
      if (!result.ok) return NextResponse.json(result, { status: result.status, headers: noStoreHeaders() });
      if (result.paymentStatus === "refunded") await query("select public.complete_orphaned_settlement_refund($1::uuid, $2::uuid, $3)", [input.paymentId, auth.actorId, input.reason]);
      return NextResponse.json(result, { headers: noStoreHeaders() });
    }
    if (input.action === "complete_orphaned_refund") {
      const payment = await query<{ status: string; amount_idr: number; refunded_amount_idr: number; orphaned_settlement: boolean }>(
        "select status, amount_idr, refunded_amount_idr, orphaned_settlement from public.payments where id = $1",
        [input.paymentId],
      );
      const row = payment.rows[0];
      if (!row?.orphaned_settlement || row.status !== "refunded" || row.refunded_amount_idr !== row.amount_idr) {
        return NextResponse.json({ error: "Refund settlement belum lengkap atau sudah direkonsiliasi." }, { status: 409, headers: noStoreHeaders() });
      }
      await query("select public.complete_orphaned_settlement_refund($1::uuid, $2::uuid, $3)", [input.paymentId, auth.actorId, input.reason]);
      return NextResponse.json({ resolved: true }, { headers: noStoreHeaders() });
    }
    if (input.action === "reconcile_refund_attempt") {
      const result = await reconcileRefundAttempt(input.attemptId, auth.actorId!, requestId);
      return NextResponse.json(result, { status: result.ok ? 200 : result.status, headers: noStoreHeaders() });
    }

    if (input.action === "reconcile_provider_creation") {
      const alert = await query<{ provider_order_id: string }>(
        `select p.provider_order_id from public.provider_reconciliation_alerts a
         join public.payments p on p.id = a.payment_id
         where a.id = $1 and a.payment_id = $2 and a.state = 'unresolved'
           and a.alert_type in ('provider_create_outcome_unknown','provider_create_finalize_lost')`,
        [input.alertId, input.paymentId],
      );
      const providerOrderId = alert.rows[0]?.provider_order_id;
      if (!providerOrderId) return NextResponse.json({ error: "Peringatan pembuatan pembayaran tidak ditemukan atau sudah ditangani." }, { status: 404, headers: noStoreHeaders() });
      const status = await providerStateBeforeCancellation(new MidtransProvider(), providerOrderId);
      if (status.state === "pending" || status.state === "unknown") {
        return NextResponse.json({ error: "Midtrans belum memastikan status akhir transaksi. Status lokal tidak diubah; coba rekonsiliasi lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
      }
      await synchronizeProviderPaymentState(input.paymentId, status);
      const resolved = await query<{ resolved: boolean }>(
        "select public.resolve_provider_reconciliation_alert($1::uuid, $2::uuid, $3) as resolved",
        [input.alertId, auth.actorId, `Provider status ${status.providerStatus} (${status.state}) verified. ${input.reason}`],
      );
      if (resolved.rows[0]?.resolved !== true) return NextResponse.json({ error: "Peringatan berubah; muat ulang daftar rekonsiliasi." }, { status: 409, headers: noStoreHeaders() });
      return NextResponse.json({ resolved: true, providerState: status.state }, { headers: noStoreHeaders() });
    }

    const alert = await query<{ payment_id: string; provider_order_id: string }>(
      `select p.id as payment_id, p.provider_order_id from public.provider_reconciliation_alerts a
       join public.payments p on p.id = a.payment_id
       where a.id = $1 and a.payment_id = $2 and a.state = 'unresolved' and a.alert_type = 'provider_refund_without_local_attempt'`,
      [input.alertId, input.paymentId],
    );
    const providerOrderId = alert.rows[0]?.provider_order_id;
    if (!providerOrderId) return NextResponse.json({ error: "Peringatan refund tidak ditemukan atau sudah ditangani." }, { status: 404, headers: noStoreHeaders() });
    const status = await new MidtransProvider().getPaymentStatus(providerOrderId);
    const confirmed = status.refunds?.find((refund) => refund.refundKey === input.refundKey);
    if (!confirmed || confirmed.amountIdr !== input.amountIdr) return NextResponse.json({ error: "Midtrans belum mengonfirmasi kunci dan jumlah refund ini. Status lokal tidak diubah." }, { status: 409, headers: noStoreHeaders() });
    // A refund notification can be the first provider event the app receives.
    // Record the verified underlying settlement before preparing its refund row.
    await synchronizeProviderPaymentState(input.paymentId, status);
    const prepared = await query<{ attempt_id: string; idempotency_key: string }>(
      "select * from public.prepare_provider_confirmed_refund_attempt($1::uuid, $2, $3, $4, $5::uuid)",
      [input.paymentId, input.refundKey, input.amountIdr, input.reason, auth.actorId],
    );
    const attempt = prepared.rows[0];
    if (!attempt) return NextResponse.json({ error: "Percobaan rekonsiliasi refund belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
    const result = await reconcileRefundAttempt(attempt.attempt_id, auth.actorId!, requestId);
    if (!result.ok) return NextResponse.json(result, { status: result.status, headers: noStoreHeaders() });
    await query("select public.resolve_provider_reconciliation_alert($1::uuid, $2::uuid, $3)", [input.alertId, auth.actorId, `Provider refund ${input.refundKey} recorded as attempt ${attempt.attempt_id}.`]);
    const payment = await query<{ orphaned_settlement: boolean }>("select orphaned_settlement from public.payments where id = $1", [input.paymentId]);
    if (payment.rows[0]?.orphaned_settlement && result.paymentStatus === "refunded") await query("select public.complete_orphaned_settlement_refund($1::uuid, $2::uuid, $3)", [input.paymentId, auth.actorId, input.reason]);
    return NextResponse.json(result, { headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "admin_reconciliation_action_failed", requestId, { errorType: error instanceof Error ? error.name : "unknown" });
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    const status = ["ORPHANED_SETTLEMENT_STOCK_UNAVAILABLE", "INVALID_REFUND_AMOUNT", "REFUND_IN_PROGRESS", "REFUND_IDEMPOTENCY_CONFLICT"].includes(message) ? 409 : 503;
    const text = message === "ORPHANED_SETTLEMENT_STOCK_UNAVAILABLE" ? "Stok tersisa tidak cukup untuk menerima settlement. Refund settlement ini sebagai gantinya."
      : message === "INVALID_REFUND_AMOUNT" ? "Saldo refund melebihi jumlah yang masih dapat dikembalikan."
        : message === "REFUND_IN_PROGRESS" ? "Refund sedang diproses. Coba rekonsiliasi lagi sebentar."
          : message === "REFUND_IDEMPOTENCY_CONFLICT" ? "Kunci refund ini sudah digunakan dengan rincian berbeda."
            : "Rekonsiliasi belum selesai. Muat ulang sebelum mencoba lagi.";
    return NextResponse.json({ error: text, retryable: status === 503 }, { status, headers: noStoreHeaders() });
  }
}
