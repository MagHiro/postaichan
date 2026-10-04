import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { categoryMutationSchema } from "@/lib/menu-schema";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

function categoryId(id: string) {
  return z.string().uuid().safeParse(id).success;
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!categoryId(id)) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const parsed = categoryMutationSchema.partial().safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan kategori tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const descriptionSet = parsed.data.description !== undefined;
    const result = await query("select * from public.update_category($1::uuid, $2, $3, $4, $5, $6, $7::uuid)", [id, parsed.data.name ?? null, descriptionSet ? (parsed.data.description ?? null) : null, descriptionSet, parsed.data.displayOrder ?? null, parsed.data.active ?? null, auth.actorId]);
    const category = result.rows[0];
    if (!category) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ category }, { headers: noStoreHeaders() });
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return NextResponse.json({ error: "Nama kategori sudah digunakan." }, { status: 409, headers: noStoreHeaders() });
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "CATEGORY_IN_USE") return NextResponse.json({ error: "Kategori masih dipakai produk aktif. Pindahkan produk dulu sebelum menonaktifkan." }, { status: 409, headers: noStoreHeaders() });
    if (message === "INVALID_CATEGORY") return NextResponse.json({ error: "Perubahan kategori tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("admin_category_update_failed", message || "unknown");
    return NextResponse.json({ error: "Perubahan kategori belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!categoryId(id)) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ deactivated: boolean } | { deactivate_category: boolean }>("select public.deactivate_category($1::uuid, $2::uuid) as deactivated", [id, auth.actorId]);
    const row = result.rows[0] as { deactivated?: boolean; deactivate_category?: boolean } | undefined;
    if (row?.deactivated !== true && row?.deactivate_category !== true) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ deactivated: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "CATEGORY_IN_USE") return NextResponse.json({ error: "Kategori masih dipakai produk aktif. Pindahkan produk dulu sebelum menonaktifkan." }, { status: 409, headers: noStoreHeaders() });
    console.error("admin_category_deactivate_failed", message || "unknown");
    return NextResponse.json({ error: "Kategori belum berhasil dinonaktifkan." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!categoryId(id)) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query("select public.reactivate_category($1::uuid, $2::uuid) as reactivated", [id, auth.actorId]);
    const row = result.rows[0] as { reactivated?: boolean; reactivate_category?: boolean } | undefined;
    if (row?.reactivated !== true && row?.reactivate_category !== true) return NextResponse.json({ error: "Kategori tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ reactivated: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_category_reactivate_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Kategori belum berhasil diaktifkan." }, { status: 503, headers: noStoreHeaders() });
  }
}
