import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { tableMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Table not found." }, { status: 400, headers: noStoreHeaders() });
  const parsed = tableMutationSchema.partial().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Table data is invalid." }, { status: 400, headers: noStoreHeaders() });
  let result;
  try {
    result = await query("select * from public.update_table_metadata($1::uuid, $2, $3, $4, $5::uuid)", [id, parsed.data.label ?? null, parsed.data.code ?? null, parsed.data.active ?? null, auth.actorId]);
  } catch (error) {
    const duplicate = databaseErrorCode(error) === "23505";
    return NextResponse.json({ error: duplicate ? "Table code already exists." : "Table could not be updated." }, { status: duplicate ? 409 : 503, headers: noStoreHeaders() });
  }
  const data = result.rows[0];
  if (!data) return NextResponse.json({ error: "Table not found." }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ table: data }, { headers: noStoreHeaders() });
}

export async function POST(request: Request, { params }: Context) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Table not found." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  let result;
  try {
    result = await query("select * from public.rotate_table_qr($1::uuid, $2, $3::uuid)", [id, hashOpaqueToken(rawToken), auth.actorId]);
  } catch (error) {
    return NextResponse.json({ error: "Table QR could not be rotated." }, { status: 503, headers: noStoreHeaders() });
  }
  const data = result.rows[0];
  if (!data) return NextResponse.json({ error: "Table not found." }, { status: 404, headers: noStoreHeaders() });
  return NextResponse.json({ table: data, orderingUrl: `/order/t/${rawToken}` }, { headers: noStoreHeaders() });
}
