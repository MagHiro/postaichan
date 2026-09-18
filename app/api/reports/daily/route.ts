import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeStaff } from "@/lib/auth/authorize-staff";
import { getDailyReport } from "@/lib/reports";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: "Staff authorization required." }, { status: 401 });
  try {
    const date = new URL(request.url).searchParams.get("date") ?? undefined;
    const report = await getDailyReport(createAdminClient(), date);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("daily_report_failed", error);
    return NextResponse.json({ error: "Daily report could not be loaded." }, { status: 503 });
  }
}
