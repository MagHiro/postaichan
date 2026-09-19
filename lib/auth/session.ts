import "server-only";
import { cookies } from "next/headers";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { query } from "@/lib/db";

export const STAFF_SESSION_COOKIE = "baranburn_staff_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export type CurrentStaff = {
  id: string;
  email: string;
  display_name: string;
  role: "operator" | "admin";
  active: boolean;
};

export async function getCurrentStaff(): Promise<CurrentStaff | null> {
  const token = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await query<CurrentStaff>(
    `select u.id, u.email, p.display_name, p.role, p.active
     from public.staff_sessions s
     join public.staff_users u on u.id = s.staff_user_id
     join public.profiles p on p.id = u.id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > timezone('utc', now())
     limit 1`,
    [hashOpaqueToken(token)],
  );
  const staff = result.rows[0] ?? null;
  if (staff) {
    void query("update public.staff_sessions set last_seen_at = timezone('utc', now()) where token_hash = $1", [hashOpaqueToken(token)]).catch(() => undefined);
  }
  return staff;
}

export async function createStaffSession(staffUserId: string) {
  const rawToken = createOpaqueToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await query(
    `insert into public.staff_sessions(staff_user_id, token_hash, expires_at)
     values ($1, $2, $3)`,
    [staffUserId, hashOpaqueToken(rawToken), expiresAt.toISOString()],
  );
  (await cookies()).set(STAFF_SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export async function revokeCurrentStaffSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(STAFF_SESSION_COOKIE)?.value;
  if (token) {
    await query("update public.staff_sessions set revoked_at = coalesce(revoked_at, timezone('utc', now())) where token_hash = $1", [hashOpaqueToken(token)]);
  }
  cookieStore.delete(STAFF_SESSION_COOKIE);
}
