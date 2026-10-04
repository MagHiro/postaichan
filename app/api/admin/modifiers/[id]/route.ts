import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { modifierGroupMutationSchema } from "@/lib/menu-schema";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function modifierId(id: string) {
  return z.string().uuid().safeParse(id).success;
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!modifierId(id)) return NextResponse.json({ error: "Grup opsi tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = modifierGroupMutationSchema.partial().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Perubahan opsi tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  if (!input.kind) return NextResponse.json({ error: "Jenis grup (variant/addon) wajib diisi." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ update_modifier_group: boolean }>(
      "select public.update_modifier_group($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10::uuid) as update_modifier_group",
      [input.kind, id, input.name ?? null, input.selection ?? null, input.required ?? null, input.minSelection ?? null, input.maxSelection ?? null, input.displayOrder ?? null, input.active ?? null, auth.actorId],
    );
    if (result.rows[0]?.update_modifier_group !== true) return NextResponse.json({ error: "Grup opsi tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ updated: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "INVALID_MODIFIER") return NextResponse.json({ error: "Perubahan opsi tidak valid." }, { status: 400, headers: noStoreHeaders() });
    if (message === "MODIFIER_GROUP_IN_USE") return NextResponse.json({ error: "Grup masih dipakai produk aktif. Lepaskan dari produk dulu." }, { status: 409, headers: noStoreHeaders() });
    if (message === "MODIFIER_GROUP_UNSATISFIABLE") return NextResponse.json({ code: message, error: "Pengaturan ini membuat produk aktif tidak memiliki pilihan yang cukup. Tambahkan pilihan yang tersedia atau ubah batas pilihan." }, { status: 409, headers: noStoreHeaders() });
    console.error("admin_modifier_group_update_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Perubahan opsi belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!modifierId(id)) return NextResponse.json({ error: "Grup opsi tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const kind = z.enum(["variant", "addon"]).safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Jenis grup (variant/addon) wajib diisi." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ delete_modifier_group: boolean }>(
      "select public.delete_modifier_group($1, $2::uuid, $3::uuid) as delete_modifier_group",
      [kind.data, id, auth.actorId],
    );
    if (result.rows[0]?.delete_modifier_group !== true) return NextResponse.json({ error: "Grup opsi tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ deleted: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "MODIFIER_GROUP_IN_USE") return NextResponse.json({ error: "Grup masih dipakai produk aktif. Lepaskan dari produk dulu." }, { status: 409, headers: noStoreHeaders() });
    if (message === "MODIFIER_GROUP_UNSATISFIABLE") return NextResponse.json({ code: message, error: "Produk aktif masih memakai grup ini. Atur grup dari produk sebelum menghapusnya." }, { status: 409, headers: noStoreHeaders() });
    console.error("admin_modifier_group_delete_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Grup opsi belum berhasil dihapus." }, { status: 503, headers: noStoreHeaders() });
  }
}
