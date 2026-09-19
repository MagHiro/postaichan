import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const schema = z.object({ amountIdr: z.number().int().positive().max(2_000_000_000), reason: z.string().trim().min(3).max(240) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Refund amount and reason are required." }, { status: 400, headers: noStoreHeaders() });
  try {
    const paymentResult = await query<{ id: string; method: string; provider: string; status: string; provider_order_id: string }>("select id, method, provider, status, provider_order_id from public.payments where order_id = $1 and status in ('settled', 'partially_refunded') order by created_at desc limit 1", [id]);
    const payment = paymentResult.rows[0];
    if (!payment) return NextResponse.json({ error: "No refundable settled payment exists." }, { status: 409, headers: noStoreHeaders() });
    if (payment.method !== "qris" || payment.provider !== "midtrans") return NextResponse.json({ error: "Cash refunds require the restaurant's manual cash-control process." }, { status: 409, headers: noStoreHeaders() });
    let claimResult;
    try {
      claimResult = await query<{ amount_idr: number; provider_order_id: string; refund_key: string }>("select * from public.claim_payment_refund($1::uuid, $2)", [payment.id, parsed.data.amountIdr]);
    } catch (error) {
      const message = (error instanceof Error ? error.message : "").split(":")[0];
      return NextResponse.json({ error: message === "REFUND_IN_PROGRESS" ? "Refund sedang diproses." : "Payment is not refundable for that amount." }, { status: 409, headers: noStoreHeaders() });
    }
    const refund = claimResult.rows[0];
    if (!refund) return NextResponse.json({ error: "Payment is not refundable for that amount." }, { status: 409, headers: noStoreHeaders() });
    try {
      await new MidtransProvider().refundPayment(refund.provider_order_id, refund.amount_idr, refund.refund_key);
    } catch (providerError) {
      await query("update public.payments set refund_claimed_at = null, refund_claimed_amount_idr = null, updated_at = timezone('utc', now()) where id = $1", [payment.id]);
      console.error("midtrans_refund_failed", providerError instanceof Error ? providerError.message : "unknown");
      return NextResponse.json({ error: "Provider belum mengonfirmasi refund." }, { status: 503, headers: noStoreHeaders() });
    }
    const result = await query("select * from public.apply_payment_refund($1::uuid, $2, $3::uuid, $4)", [payment.id, refund.amount_idr, auth.actorId, parsed.data.reason]);
    return NextResponse.json({ refunded: true, payment: result.rows[0], reason: parsed.data.reason }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("refund_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Refund was submitted to the provider but could not be finalized locally. Reconcile before retrying." }, { status: 503, headers: noStoreHeaders() });
  }
}
