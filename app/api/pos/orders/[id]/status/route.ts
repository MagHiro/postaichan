import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { uuidParamSchema } from "@/lib/schemas";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const allowed = new Set(["accepted", "processing", "ready", "completed", "cancelled"]);

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  const body = await request.json().catch(() => null);
  if (!body || typeof body.status !== "string" || !allowed.has(body.status)) return NextResponse.json({ error: "Invalid order status." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const { data: current, error: currentError } = await supabase.from("orders").select("status").eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const { data: changed, error } = await supabase.rpc("transition_order_status", { p_order_id: id, p_expected_status: current.status, p_next_status: body.status, p_actor_id: auth.actorId });
    if (error) throw error;
    if (changed !== true) return NextResponse.json({ error: "Order changed or cannot move to that status." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ ok: true, status: body.status }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_order_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Order status could not be updated." }, { status: 503, headers: noStoreHeaders() });
  }
}
