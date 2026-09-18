import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";

export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from("restaurant_tables").select("id, label, code, active").order("code", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ tables: data ?? [] });
  } catch (error) {
    console.error("pos_tables_failed", error);
    return NextResponse.json({ error: "Meja belum dapat dimuat." }, { status: 503 });
  }
}
