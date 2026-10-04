import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { query } from "@/lib/db";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { STAFF_SESSION_COOKIE } from "@/lib/auth/session";
import { consumeRateLimit, noStoreHeaders, readJsonBody, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const schema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) }).strict();

export async function POST(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed || !auth.actorId) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Password baru harus berisi sedikitnya 12 karakter." }, { status: 400, headers: noStoreHeaders() });
  if (!(await consumeRateLimit(request, "staff-password-change", 5, 900, auth.actorId))) return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi nanti." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "900" } });
  try {
    const userResult = await query<{ password_hash: string }>("select password_hash from public.staff_users where id = $1", [auth.actorId]);
    const user = userResult.rows[0];
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.password_hash))) return NextResponse.json({ error: "Password saat ini tidak valid." }, { status: 401, headers: noStoreHeaders() });
    const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.json({ error: "Sesi tidak valid. Masuk kembali." }, { status: 401, headers: noStoreHeaders() });
    const newHash = await hashPassword(parsed.data.newPassword);
    await query("select public.change_staff_password($1::uuid, $2, $3::uuid, $4)", [auth.actorId, newHash, auth.actorId, hashOpaqueToken(token)]);
    return NextResponse.json({ changed: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("staff_password_change_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Password belum dapat diubah." }, { status: 503, headers: noStoreHeaders() });
  }
}
