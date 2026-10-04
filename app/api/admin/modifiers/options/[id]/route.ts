import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { modifierOptionMutationSchema } from "@/lib/menu-schema";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function optionId(id: string) {
  return z.string().uuid().safeParse(id).success;
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!optionId(id)) return NextResponse.json({ error: "Opsi tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const parsed = modifierOptionMutationSchema.partial().omit({ groupId: true }).safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan opsi tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  if (!input.kind) return NextResponse.json({ error: "Jenis opsi (variant/addon) wajib diisi." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ update_modifier_option: boolean }>(
      "select public.update_modifier_option($1, $2::uuid, $3, $4, $5, $6, $7, $8::uuid) as update_modifier_option",
      [input.kind, id, input.name ?? null, input.priceAdjustmentIdr ?? null, input.costAdjustmentIdr ?? null, input.available ?? null, input.displayOrder ?? null, auth.actorId],
    );
    if (result.rows[0]?.update_modifier_option !== true) return NextResponse.json({ error: "Opsi tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ updated: true }, { headers: noStoreHeaders() });
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return NextResponse.json({ error: "Nama opsi sudah dipakai di grup ini." }, { status: 409, headers: noStoreHeaders() });
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "INVALID_MODIFIER") return NextResponse.json({ error: "Perubahan opsi tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("admin_modifier_option_update_failed", message || "unknown");
    return NextResponse.json({ error: "Perubahan opsi belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!optionId(id)) return NextResponse.json({ error: "Opsi tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const kind = z.enum(["variant", "addon"]).safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Jenis opsi (variant/addon) wajib diisi." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ delete_modifier_option: boolean }>(
      "select public.delete_modifier_option($1, $2::uuid, $3::uuid) as delete_modifier_option",
      [kind.data, id, auth.actorId],
    );
    if (result.rows[0]?.delete_modifier_option !== true) return NextResponse.json({ error: "Opsi tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ deleted: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    console.error("admin_modifier_option_delete_failed", message || "unknown");
    return NextResponse.json({ error: "Opsi belum berhasil dihapus." }, { status: 503, headers: noStoreHeaders() });
  }
}
