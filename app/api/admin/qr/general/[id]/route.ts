import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { createAdminClient } from "@/lib/supabase/admin";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const updateSchema = z.object({ label: z.string().trim().min(1).max(80).optional(), active: z.boolean().optional() }).strict().refine((value) => value.label !== undefined || value.active !== undefined, "Change required");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "QR umum tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan QR tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const { data, error } = await createAdminClient().rpc("update_general_qr", { p_qr_id: id, p_label: parsed.data.label ?? null, p_active: parsed.data.active ?? null, p_actor_id: auth.actorId });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Label QR sudah digunakan." : "Perubahan QR belum tersimpan." }, { status: error.code === "23505" ? 409 : 503, headers: noStoreHeaders() });
  const code = Array.isArray(data) ? data[0] : data;
  if (!code) return NextResponse.json({ error: "QR umum tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ code }, { headers: noStoreHeaders() });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "QR umum tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  const { data: rotated, error } = await createAdminClient().rpc("rotate_general_qr", { p_qr_id: id, p_token_hash: hashOpaqueToken(rawToken), p_actor_id: auth.actorId });
  if (error) return NextResponse.json({ error: "QR umum belum dapat dirotasi." }, { status: 503, headers: noStoreHeaders() });
  const code = Array.isArray(rotated) ? rotated[0] : rotated;
  if (!code) return NextResponse.json({ error: "QR umum tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ code, orderingUrl: `/order/g/${rawToken}` }, { headers: noStoreHeaders() });
}
