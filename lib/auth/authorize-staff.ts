import { createClient } from "@/lib/supabase/server";

export async function authorizeStaff() {
  // Local development can use the configured server key before staff Auth is seeded.
  // Production still requires an active Supabase Auth profile.
  if (process.env.NODE_ENV !== "production") return { allowed: true, actorId: null };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { allowed: false, actorId: null };
  const { data: profile } = await supabase.from("profiles").select("id, active").eq("id", user.id).maybeSingle();
  return { allowed: profile?.active === true, actorId: user.id };
}
