import { getCurrentStaff } from "@/lib/auth/session";
import { query } from "@/lib/db";

export type RequiredRole = "operator" | "admin";
export type StaffAuthorization = {
  allowed: boolean;
  authenticated: boolean;
  actorId: string | null;
  role: "operator" | "admin" | null;
};

export async function authorizeStaff(requiredRole: RequiredRole = "operator"): Promise<StaffAuthorization> {
  // A bypass is deliberately explicit and development-only. Preview/staging
  // deployments fail closed just like production.
  if (process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_STAFF_BYPASS === "true") {
    const result = await query<{ id: string; role: "operator" | "admin" }>(
      `select u.id, p.role
       from public.staff_users u
       join public.profiles p on p.id = u.id
       where p.active = true
         and ($1::public.staff_role = 'operator' or p.role = 'admin')
       order by case when p.role = 'admin' then 0 else 1 end, u.created_at asc
       limit 1`,
      [requiredRole],
    );
    const actor = result.rows[0];
    if (!actor) return { allowed: false, authenticated: false, actorId: null, role: null };
    return { allowed: true, authenticated: true, actorId: actor.id, role: actor.role };
  }
  const staff = await getCurrentStaff();
  if (!staff) return { allowed: false, authenticated: false, actorId: null, role: null };
  const allowed = requiredRole === "operator" || staff.role === "admin";
  return { allowed, authenticated: true, actorId: staff.id, role: staff.role };
}

export function authFailureStatus(auth: StaffAuthorization) {
  return auth.authenticated ? 403 : 401;
}
