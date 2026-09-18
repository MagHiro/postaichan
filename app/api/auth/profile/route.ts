import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

// This endpoint is a read/verification endpoint only. Staff profiles must be
// provisioned by an administrator or deployment migration, never by sign-up.
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: noStoreHeaders() });
  const { data: profile, error } = await supabase.from("profiles").select("id, display_name, role, active").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Staff profile could not be checked." }, { status: 503, headers: noStoreHeaders() });
  if (!profile?.active) return NextResponse.json({ error: "This account is not provisioned as staff." }, { status: 403, headers: noStoreHeaders() });
  return NextResponse.json({ profile }, { headers: noStoreHeaders() });
}
