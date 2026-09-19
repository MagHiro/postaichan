import { getCurrentStaff } from "@/lib/auth/session";

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
    return { allowed: true, authenticated: true, actorId: null, role: "admin" as const };
  }
  const staff = await getCurrentStaff();
  if (!staff) return { allowed: false, authenticated: false, actorId: null, role: null };
  const allowed = requiredRole === "operator" || staff.role === "admin";
  return { allowed, authenticated: true, actorId: staff.id, role: staff.role };
}

export function authFailureStatus(auth: StaffAuthorization) {
  return auth.authenticated ? 403 : 401;
}
