import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { hashPassword } from "@/lib/auth/password";
import { databaseErrorCode, query, withTransaction } from "@/lib/db";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

const createSchema = z.object({ displayName: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email().max(254), initialPassword: z.string().min(12).max(128), role: z.enum(["operator", "admin"]).default("operator") }).strict();

function failure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return failure(auth);
  try {
    const result = await query("select p.id, p.display_name, u.email, p.role, p.active, p.created_at, p.updated_at from public.profiles p join public.staff_users u on u.id = p.id order by p.display_name asc");
    return NextResponse.json({ staff: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_staff_list_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Akun staff belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return failure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Nama, email, password awal, dan role harus valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "staff-create", 8, 900, auth.actorId ?? "dev"))) return NextResponse.json({ error: "Terlalu banyak pembuatan akun. Coba lagi nanti." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "900" } });
    const passwordHash = await hashPassword(parsed.data.initialPassword);
    const staff = await withTransaction(async (client) => {
      const user = await client.query<{ id: string }>("insert into public.staff_users(email, password_hash, email_confirmed) values ($1, $2, true) returning id", [parsed.data.email, passwordHash]);
      const profile = await client.query("select * from public.provision_staff_profile($1::uuid, $2, $3::public.staff_role, $4::uuid)", [user.rows[0].id, parsed.data.displayName, parsed.data.role, auth.actorId]);
      return profile.rows[0];
    });
    return NextResponse.json({ staff: { ...staff, email: parsed.data.email } }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const duplicate = databaseErrorCode(error) === "23505";
    if (duplicate) return NextResponse.json({ error: "Akun dengan email tersebut sudah ada." }, { status: 409, headers: noStoreHeaders() });
    console.error("admin_staff_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Akun staff belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
