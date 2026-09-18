import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const schema = z.object({ amountIdr: z.number().int().positive().max(2_000_000_000), reason: z.string().trim().min(3).max(240) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Refund amount and reason are required." }, { status: 400, headers: noStoreHeaders() });
  const supabase = createAdminClient();
  try {
    const { data: payment, error } = await supabase.from("payments").select("id, method, provider, status, provider_order_id").eq("order_id", id).in("status", ["settled", "partially_refunded"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!payment) return NextResponse.json({ error: "No refundable settled payment exists." }, { status: 409, headers: noStoreHeaders() });
    if (payment.method !== "qris" || payment.provider !== "midtrans") return NextResponse.json({ error: "Cash refunds require the restaurant's manual cash-control process." }, { status: 409, headers: noStoreHeaders() });
    const { data: claim, error: claimError } = await supabase.rpc("claim_payment_refund", { p_payment_id: payment.id, p_amount_idr: parsed.data.amountIdr });
    if (claimError) {
      const message = String(claimError.message || "").split(":")[0];
      return NextResponse.json({ error: message === "REFUND_IN_PROGRESS" ? "Refund sedang diproses." : "Payment is not refundable for that amount." }, { status: 409, headers: noStoreHeaders() });
    }
    const refund = Array.isArray(claim) ? claim[0] : claim;
    try {
      await new MidtransProvider().refundPayment(refund.provider_order_id, refund.amount_idr, refund.refund_key);
    } catch (providerError) {
      await supabase.from("payments").update({ refund_claimed_at: null, refund_claimed_amount_idr: null }).eq("id", payment.id);
      console.error("midtrans_refund_failed", providerError instanceof Error ? providerError.message : "unknown");
      return NextResponse.json({ error: "Provider belum mengonfirmasi refund." }, { status: 503, headers: noStoreHeaders() });
    }
    const { data: result, error: applyError } = await supabase.rpc("apply_payment_refund", { p_payment_id: payment.id, p_amount_idr: refund.amount_idr, p_actor_id: auth.actorId, p_reason: parsed.data.reason });
    if (applyError) throw applyError;
    return NextResponse.json({ refunded: true, payment: Array.isArray(result) ? result[0] : result, reason: parsed.data.reason }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("refund_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Refund was submitted to the provider but could not be finalized locally. Reconcile before retrying." }, { status: 503, headers: noStoreHeaders() });
  }
}
