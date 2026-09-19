import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
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
    const current = await query<{ status: string }>("select status from public.orders where id = $1", [id]);
    if (!current.rows[0]) return NextResponse.json({ error: "Order not found." }, { status: 404, headers: noStoreHeaders() });
    const changed = await query<{ transition_order_status: boolean }>("select public.transition_order_status($1::uuid, $2::public.order_status, $3::public.order_status, $4::uuid) as transition_order_status", [id, current.rows[0].status, parsed.data.status, auth.actorId]);
    if (changed.rows[0]?.transition_order_status !== true) return NextResponse.json({ error: "Order changed or cannot move to that status." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ ok: true, status: parsed.data.status }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_order_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Order status could not be updated." }, { status: 503, headers: noStoreHeaders() });
  }
}
