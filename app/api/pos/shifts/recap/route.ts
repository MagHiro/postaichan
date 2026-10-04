import { NextResponse } from "next/server";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { getCloseRecap } from "@/lib/shift-report";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

/** Full close recap for the currently open shift. */
export async function GET() {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Staff authorization is insufficient.", "Staff authorization required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const recap = await getCloseRecap();
    if (!recap) return NextResponse.json({ recap: null }, { headers: noStoreHeaders() });
    return NextResponse.json({ recap }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("shift_recap_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Rekap kasir belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
