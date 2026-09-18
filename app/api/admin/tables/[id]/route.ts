import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { tableMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Table not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = tableMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Table data is invalid." }, { status: 400, headers: noStoreHeaders() });
  const { data, error } = await createAdminClient().from("restaurant_tables").update(parsed.data).eq("id", id).select("id, label, code, active, qr_token_version").maybeSingle();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Table code already exists." : "Table could not be updated." }, { status: error.code === "23505" ? 409 : 503, headers: noStoreHeaders() });
  if (!data) return NextResponse.json({ error: "Table not found." }, { status: 404, headers: noStoreHeaders() });
  const supabase = createAdminClient();
  const { error: auditError } = await supabase.from("audit_logs").insert({ actor_id: auth.actorId, action: "table_updated", entity_type: "restaurant_table", entity_id: id, new_value: parsed.data });
  if (auditError) {
    console.error("table_update_audit_failed", auditError.message);
    return NextResponse.json({ error: "Table was updated, but the audit record could not be written." }, { status: 503, headers: noStoreHeaders() });
  }
  return NextResponse.json({ table: data }, { headers: noStoreHeaders() });
}

export async function POST(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: "Administrator authorization required." }, { status: auth.actorId ? 403 : 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Table not found." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  const supabase = createAdminClient();
  const { data: rotated, error } = await supabase.rpc("rotate_table_qr", { p_table_id: id, p_token_hash: hashOpaqueToken(rawToken) });
  const data = Array.isArray(rotated) ? rotated[0] : rotated;
  if (error) return NextResponse.json({ error: "Table QR could not be rotated." }, { status: 503, headers: noStoreHeaders() });
  if (!data) return NextResponse.json({ error: "Table not found." }, { status: 404, headers: noStoreHeaders() });
  const { error: auditError } = await supabase.from("audit_logs").insert({ actor_id: auth.actorId, action: "table_qr_rotated", entity_type: "restaurant_table", entity_id: id, new_value: { qr_token_version: data.qr_token_version } });
  if (auditError) return NextResponse.json({ error: "QR rotated but audit logging failed." }, { status: 503, headers: noStoreHeaders() });
  return NextResponse.json({ table: data, orderingUrl: `/order/t/${rawToken}` }, { headers: noStoreHeaders() });
}
