import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { hashPassword } from "@/lib/auth/password";
import { databaseErrorCode, query } from "@/lib/db";
import { readJsonBody, consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

const createSchema = z.object({ displayName: z.string().trim().min(2).max(80), email: z.string().trim().toLowerCase().email().max(254), initialPassword: z.string().min(12).max(128), role: z.enum(["operator", "admin"]).default("operator") }).strict();

function failure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return failure(auth);
  try {
    const result = await query("select p.id, p.display_name, u.email, p.role, p.active, p.created_at, p.updated_at from public.profiles p join public.staff_users u on u.id = p.id order by p.display_name asc");
    return NextResponse.json({ staff: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_staff_list_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Akun staff belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return failure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Nama, email, password awal, dan role harus valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "staff-create", 8, 900, auth.actorId ?? "dev"))) return NextResponse.json({ error: "Terlalu banyak pembuatan akun. Coba lagi nanti." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "900" } });
    const passwordHash = await hashPassword(parsed.data.initialPassword);
    const result = await query(
      "select * from public.create_staff_account($1, $2, $3, $4::public.staff_role, $5::uuid)",
      [parsed.data.email, passwordHash, parsed.data.displayName, parsed.data.role, auth.actorId],
    );
    const staff = result.rows[0];
    return NextResponse.json({ staff: { ...staff, email: parsed.data.email } }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const duplicate = databaseErrorCode(error) === "23505";
    if (duplicate) return NextResponse.json({ error: "Akun dengan email tersebut sudah ada." }, { status: 409, headers: noStoreHeaders() });
    console.error("admin_staff_create_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Akun staff belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
