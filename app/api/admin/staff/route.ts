import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createAdminClient } from "@/lib/supabase/admin";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const createSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  initialPassword: z.string().min(12).max(128),
  role: z.enum(["operator", "admin"]).default("operator"),
}).strict();

function failure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return failure(auth);
  try {
    const supabase = createAdminClient();
    const [{ data: profiles, error: profileError }, { data: users, error: userError }] = await Promise.all([
      supabase.from("profiles").select("id, display_name, role, active, created_at, updated_at").order("display_name", { ascending: true }),
      supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    if (profileError) throw profileError;
    if (userError) throw userError;
    const emailById = new Map((users.users ?? []).map((user) => [user.id, user.email ?? ""]));
    return NextResponse.json({ staff: (profiles ?? []).map((profile) => ({ ...profile, email: emailById.get(profile.id) ?? "" })) }, { headers: noStoreHeaders() });
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
    const supabase = createAdminClient();
    const { data: created, error: createError } = await supabase.auth.admin.createUser({ email: parsed.data.email, password: parsed.data.initialPassword, email_confirm: true, user_metadata: { display_name: parsed.data.displayName } });
    if (createError || !created.user) return NextResponse.json({ error: "Akun dengan email tersebut belum dapat dibuat." }, { status: createError?.status === 422 ? 409 : 503, headers: noStoreHeaders() });
    const { data: profile, error: profileError } = await supabase.rpc("provision_staff_profile", { p_user_id: created.user.id, p_display_name: parsed.data.displayName, p_role: parsed.data.role, p_actor_id: auth.actorId });
    if (profileError) {
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(created.user.id);
      if (cleanupError) console.error("staff_auth_compensation_failed", cleanupError.message);
      return NextResponse.json({ error: "Akun belum dapat diprovision sebagai staff." }, { status: 503, headers: noStoreHeaders() });
    }
    const row = Array.isArray(profile) ? profile[0] : profile;
    return NextResponse.json({ staff: { ...row, email: parsed.data.email } }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_staff_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Akun staff belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
