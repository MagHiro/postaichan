import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { hashPassword } from "@/lib/auth/password";
import { query } from "@/lib/db";
import { noStoreHeaders, readJsonBody, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const schema = z.object({ newPassword: z.string().min(12).max(128) }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Akun staff tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Password baru harus berisi sedikitnya 12 karakter." }, { status: 400, headers: noStoreHeaders() });
  try {
    const passwordHash = await hashPassword(parsed.data.newPassword);
    await query("select public.change_staff_password($1::uuid, $2, $3::uuid, null)", [id, passwordHash, auth.actorId]);
    return NextResponse.json({ reset: true, sessionsRevoked: true }, { headers: noStoreHeaders() });
  } catch (error) {
    const code = error instanceof Error ? error.message.split(":")[0] : "";
    return NextResponse.json({ error: code === "STAFF_NOT_FOUND" ? "Akun staff tidak ditemukan." : "Password belum dapat direset." }, { status: code === "STAFF_NOT_FOUND" ? 404 : 503, headers: noStoreHeaders() });
  }
}
