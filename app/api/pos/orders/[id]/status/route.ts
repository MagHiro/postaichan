import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { uuidParamSchema } from "@/lib/schemas";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const statusSchema = z.object({ status: z.enum(["accepted", "processing", "ready", "completed", "cancelled"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Order not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid order status." }, { status: 400, headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const { data: current, error: currentError } = await supabase.from("orders").select("status").eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const { data: changed, error } = await supabase.rpc("transition_order_status", { p_order_id: id, p_expected_status: current.status, p_next_status: parsed.data.status, p_actor_id: auth.actorId });
    if (error) throw error;
    if (changed !== true) return NextResponse.json({ error: "Order changed or cannot move to that status." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ ok: true, status: parsed.data.status }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_order_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Order status could not be updated." }, { status: 503, headers: noStoreHeaders() });
  }
}
