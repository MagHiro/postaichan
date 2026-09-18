import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("profiles").upsert({ id: user.id, display_name: user.user_metadata?.display_name ?? user.email?.split("@")[0] ?? "Operator", role: "operator", active: true }, { onConflict: "id", ignoreDuplicates: true });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("profile_bootstrap_failed", error);
    return NextResponse.json({ error: "Staff profile could not be prepared." }, { status: 503 });
  }
}
