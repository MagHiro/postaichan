import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { getDailyReport } from "@/lib/reports";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401, headers: noStoreHeaders() });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    const report = await getDailyReport(createAdminClient(), date);
    return NextResponse.json(report, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_REPORT_DATE") return NextResponse.json({ error: "Tanggal laporan tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("daily_report_failed", error);
    return NextResponse.json({ error: "Daily report could not be loaded." }, { status: 503, headers: noStoreHeaders() });
  }
}
