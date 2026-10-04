import { NextResponse } from "next/server";
import { revokeCurrentStaffSession } from "@/lib/auth/session";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  await revokeCurrentStaffSession();
  return NextResponse.json({ ok: true }, { headers: noStoreHeaders() });
}
