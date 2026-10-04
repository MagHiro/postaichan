import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { processRefundAttempt } from "@/lib/payments/refund-workflow";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

export const runtime = "nodejs";
const schema = z.object({ idempotencyKey: z.string().uuid(), amountIdr: z.number().int().positive().max(2_000_000_000), reason: z.string().trim().min(3).max(240) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = createRequestId();
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Refund amount and reason are required." }, { status: 400, headers: noStoreHeaders() });
  try {
    const paymentResult = await query<{ id: string; method: string; provider: string; status: string; provider_order_id: string }>("select id, method, provider, status, provider_order_id from public.payments where order_id = $1 and status in ('settled', 'partially_refunded') order by created_at desc limit 1", [id]);
    const payment = paymentResult.rows[0];
    if (!payment) return NextResponse.json({ error: "Tidak ada pembayaran lunas yang bisa direfund." }, { status: 409, headers: noStoreHeaders() });
    if (payment.method !== "qris" || payment.provider !== "midtrans") return NextResponse.json({ error: "Refund tunai mengikuti proses kontrol kas manual restoran." }, { status: 409, headers: noStoreHeaders() });
    const result = await processRefundAttempt({ paymentId: payment.id, amountIdr: parsed.data.amountIdr, reason: parsed.data.reason, idempotencyKey: parsed.data.idempotencyKey, actorId: auth.actorId!, requestId });
    if (!result.ok) return NextResponse.json(result, { status: result.status, headers: noStoreHeaders() });
    return NextResponse.json({ refunded: true, alreadyApplied: result.alreadyApplied, paymentStatus: result.paymentStatus, refundedAmountIdr: result.refundedAmountIdr, attemptId: result.attemptId }, { headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "refund_failed", requestId, { orderId: id, errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ code: "REFUND_WORKFLOW_FAILED", error: "Refund belum selesai. Gunakan kunci idempotensi yang sama saat mencoba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
  }
}
