import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("restaurant_tables").select("id, label, code, active").order("code", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ tables: data ?? [] }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_tables_failed", error);
    return NextResponse.json({ error: "Meja belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
