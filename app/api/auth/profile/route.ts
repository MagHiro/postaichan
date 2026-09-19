import { NextResponse } from "next/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

async function profileResponse() {
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: noStoreHeaders() });
  if (!staff.active) return NextResponse.json({ error: "Active staff account required." }, { status: 403, headers: noStoreHeaders() });
  return NextResponse.json({ profile: { id: staff.id, display_name: staff.display_name, role: staff.role, active: staff.active } }, { headers: noStoreHeaders() });
}

export async function GET() { return profileResponse(); }
export async function POST() { return profileResponse(); }
