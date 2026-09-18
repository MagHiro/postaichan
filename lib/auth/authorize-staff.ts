import { createClient } from "@/lib/supabase/server";

export type RequiredRole = "operator" | "admin";

export async function authorizeStaff(requiredRole: RequiredRole = "operator") {
  // A bypass is deliberately explicit and development-only. Preview/staging
  // deployments fail closed just like production.
  if (process.env.NODE_ENV === "development" && process.env.ALLOW_DEV_STAFF_BYPASS === "true") {
    return { allowed: true, actorId: null, role: "admin" as const };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { allowed: false, actorId: null, role: null };
  const { data: profile, error } = await supabase.from("profiles").select("id, active, role").eq("id", user.id).maybeSingle();
  if (error || !profile?.active) return { allowed: false, actorId: user.id, role: null };
  const allowed = requiredRole === "operator" || profile.role === "admin";
  return { allowed, actorId: user.id, role: profile.role as "operator" | "admin" };
}
