import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { shiftOpenSchema } from "@/lib/schemas";
import { shiftDatabaseFailure } from "@/lib/domain/shift-errors";
import { invalidCheckoutInput } from "@/lib/domain/checkout-errors";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = shiftOpenSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const failure = invalidCheckoutInput(parsed.error.issues[0]);
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
  try {
    const result = await query<{ open_cashier_shift: string }>("select public.open_cashier_shift($1::uuid, $2, $3::jsonb)", [auth.actorId, parsed.data.note ?? null, JSON.stringify(parsed.data.items)]);
    const shiftId = result.rows[0]?.open_cashier_shift;
    if (!shiftId) return NextResponse.json({ error: "Kasir belum berhasil dibuka." }, { status: 503, headers: noStoreHeaders() });
    return NextResponse.json({ shiftId }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const failure = shiftDatabaseFailure(error);
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
}
