import { NextResponse } from "next/server";
import { z } from "zod";
import { createStaffSession } from "@/lib/auth/session";
import { verifyPassword } from "@/lib/auth/password";
import { query } from "@/lib/db";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
}).strict();

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Email atau password tidak cocok." }, { status: 401, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "staff-login", 8, 300, parsed.data.email))) return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    const result = await query<{ id: string; password_hash: string; active: boolean }>(
      `select u.id, u.password_hash, p.active
       from public.staff_users u join public.profiles p on p.id = u.id
       where u.email = $1 and u.email_confirmed = true limit 1`,
      [parsed.data.email],
    );
    const user = result.rows[0];
    if (!user || !user.active || !(await verifyPassword(parsed.data.password, user.password_hash))) {
      return NextResponse.json({ error: "Email atau password tidak cocok." }, { status: 401, headers: noStoreHeaders() });
    }
    await query("update public.staff_users set last_login_at = timezone('utc', now()) where id = $1", [user.id]);
    await createStaffSession(user.id);
    return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("staff_login_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Login belum dapat diproses. Coba lagi sebentar." }, { status: 503, headers: noStoreHeaders() });
  }
}
