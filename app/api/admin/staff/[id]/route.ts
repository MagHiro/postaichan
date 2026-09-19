import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const updateSchema = z.object({ active: z.boolean().optional(), role: z.enum(["operator", "admin"]).optional() }).strict().refine((value) => value.active !== undefined || value.role !== undefined, "At least one change is required.");

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Akun staff tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Perubahan akun tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const { data, error } = await createAdminClient().rpc("update_staff_profile", { p_user_id: id, p_active: parsed.data.active ?? null, p_role: parsed.data.role ?? null, p_actor_id: auth.actorId });
    if (error) {
      const message = String(error.message || "").split(":")[0];
      const text = message === "SELF_ADMIN_PROTECTION" ? "Admin tidak dapat menonaktifkan atau menurunkan role akunnya sendiri." : message === "LAST_ACTIVE_ADMIN" ? "Tidak dapat mengubah admin aktif terakhir." : message === "STAFF_NOT_FOUND" ? "Akun staff tidak ditemukan." : "Perubahan akun belum tersimpan.";
      return NextResponse.json({ error: text }, { status: message === "STAFF_NOT_FOUND" ? 404 : 409, headers: noStoreHeaders() });
    }
    const row = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ staff: row }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_staff_update_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Perubahan akun belum tersimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}
