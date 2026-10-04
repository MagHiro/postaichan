import { getCurrentStaff } from "@/lib/auth/session";
import { query } from "@/lib/db";
import { consumeIdentityRateLimit } from "@/lib/security/request";

export type RequiredRole = "operator" | "admin";
export type StaffAuthorization = {
  allowed: boolean;
  authenticated: boolean;
  actorId: string | null;
  role: "operator" | "admin" | null;
  rateLimited?: boolean;
};

async function applyActorLimit(auth: StaffAuthorization): Promise<StaffAuthorization> {
  if (!auth.allowed || !auth.actorId) return auth;
  const allowed = await consumeIdentityRateLimit("staff-authenticated", auth.actorId, 1_200, 60);
  return allowed ? auth : { ...auth, allowed: false, rateLimited: true };
}

export async function authorizeStaff(requiredRole: RequiredRole = "operator"): Promise<StaffAuthorization> {
  // A bypass is deliberately explicit and development-only. Preview/staging
  // deployments fail closed just like production.
  const { allowDevStaffBypass } = (await import("@/lib/config")).getServerConfig();
  if (allowDevStaffBypass) {
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
    return applyActorLimit({ allowed: true, authenticated: true, actorId: actor.id, role: actor.role });
  }
  const staff = await getCurrentStaff();
  if (!staff) return { allowed: false, authenticated: false, actorId: null, role: null };
  const allowed = staff.active && (requiredRole === "operator" || staff.role === "admin");
  return applyActorLimit({ allowed, authenticated: true, actorId: staff.id, role: staff.role });
}

export function authFailureStatus(auth: StaffAuthorization) {
  if (auth.rateLimited) return 429;
  return auth.authenticated ? 403 : 401;
}

export function authFailureMessage(auth: StaffAuthorization, authenticatedMessage: string, unauthenticatedMessage: string) {
  if (auth.rateLimited) return "Too many requests. Please try again later.";
  return auth.authenticated ? authenticatedMessage : unauthenticatedMessage;
}
