import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { tableMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Table not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = tableMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Table data is invalid." }, { status: 400, headers: noStoreHeaders() });
  const supabase = createAdminClient();
  const { data: updated, error } = await supabase.rpc("update_table_metadata", { p_table_id: id, p_label: parsed.data.label ?? null, p_code: parsed.data.code ?? null, p_active: parsed.data.active ?? null, p_actor_id: auth.actorId });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Table code already exists." : "Table could not be updated." }, { status: error.code === "23505" ? 409 : 503, headers: noStoreHeaders() });
  const data = Array.isArray(updated) ? updated[0] : updated;
  if (!data) return NextResponse.json({ error: "Table not found." }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ table: data }, { headers: noStoreHeaders() });
}

export async function POST(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Table not found." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  const supabase = createAdminClient();
  const { data: rotated, error } = await supabase.rpc("rotate_table_qr", { p_table_id: id, p_token_hash: hashOpaqueToken(rawToken), p_actor_id: auth.actorId });
  const data = Array.isArray(rotated) ? rotated[0] : rotated;
  if (error) return NextResponse.json({ error: "Table QR could not be rotated." }, { status: 503, headers: noStoreHeaders() });
  if (!data) return NextResponse.json({ error: "Table not found." }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ table: data, orderingUrl: `/order/t/${rawToken}` }, { headers: noStoreHeaders() });
}
