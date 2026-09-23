import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET() {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query<{ id: string; opened_at: string; opened_by: string | null; opening_note: string | null }>(
      "select id, opened_at, opened_by, opening_note from public.cashier_shifts where closed_at is null order by opened_at desc limit 1",
    );
    const shift = result.rows[0] ?? null;
    return NextResponse.json({ open: shift !== null, shift }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("shift_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Status kasir belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
