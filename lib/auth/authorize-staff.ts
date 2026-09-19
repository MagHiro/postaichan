import { createClient } from "@/lib/supabase/server";

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
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { allowed: false, authenticated: false, actorId: null, role: null };
  const { data: profile, error } = await supabase.from("profiles").select("id, active, role").eq("id", user.id).maybeSingle();
  if (error || !profile?.active) return { allowed: false, authenticated: true, actorId: user.id, role: null };
  const allowed = requiredRole === "operator" || profile.role === "admin";
  return { allowed, authenticated: true, actorId: user.id, role: profile.role as "operator" | "admin" };
}

export function authFailureStatus(auth: StaffAuthorization) {
  return auth.authenticated ? 403 : 401;
}
