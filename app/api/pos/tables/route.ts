import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Staff authorization is insufficient.", "Staff authorization required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query("select id, label, code, active from public.restaurant_tables order by code asc");
    return NextResponse.json({ tables: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_tables_failed", { errorType: error instanceof Error ? error.name : "unknown" });
    return NextResponse.json({ error: "Meja belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
