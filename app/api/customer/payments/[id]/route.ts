import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = request.headers.get("x-order-access-token");
  if (!token) return NextResponse.json({ error: "Order access token required." }, { status: 401 });
  const { id } = await params;
  try {
    const supabase = createAdminClient();
    const { data: session } = await supabase.from("customer_sessions").select("id, expires_at").eq("access_token_hash", hashToken(token)).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (!session) return NextResponse.json({ error: "Order session expired." }, { status: 401 });
    const { data: order, error: orderError } = await supabase.from("orders").select("id, order_number, status").eq("id", id).eq("customer_session_id", session.id).single();
    if (orderError || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const { data: payment, error: paymentError } = await supabase.from("payments").select("status, expires_at, amount_idr").eq("order_id", id).order("created_at", { ascending: false }).limit(1).single();
    if (paymentError) throw paymentError;
    return NextResponse.json({ orderNumber: order.order_number, orderStatus: order.status, paymentStatus: payment.status, expiresAt: payment.expires_at, amountIdr: payment.amount_idr });
  } catch (error) {
    console.error("customer_payment_status_failed", error);
    return NextResponse.json({ error: "We couldn't check payment yet." }, { status: 503 });
  }
}
