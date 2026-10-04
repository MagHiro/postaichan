import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { query } from "@/lib/db";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Akun staff tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ revoke_staff_sessions: number }>("select public.revoke_staff_sessions($1::uuid, $2::uuid)", [id, auth.actorId]);
    return NextResponse.json({ revokedCount: result.rows[0]?.revoke_staff_sessions ?? 0 }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_staff_sessions_revoke_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Sesi akun belum dapat dicabut." }, { status: 503, headers: noStoreHeaders() });
  }
}
