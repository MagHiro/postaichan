import { NextResponse } from "next/server";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { getReport } from "@/lib/reports";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const params = new URL(request.url).searchParams;
    const date = params.get("date") ?? undefined;
    const from = params.get("from") ?? date;
    const to = params.get("to") ?? date;
    const report = await getReport(from ?? undefined, to ?? undefined);
    return NextResponse.json(report, { headers: noStoreHeaders() });
  } catch (error) {
    if (error instanceof Error && ["INVALID_REPORT_DATE", "REPORT_RANGE_LIMIT"].includes(error.message)) return NextResponse.json({ error: error.message === "REPORT_RANGE_LIMIT" ? "Rentang laporan maksimal 31 hari." : "Tanggal laporan tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("daily_report_failed", error);
    return NextResponse.json({ error: "Daily report could not be loaded." }, { status: 503, headers: noStoreHeaders() });
  }
}
