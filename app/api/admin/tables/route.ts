import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { tableMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const createSchema = tableMutationSchema.extend({ active: z.boolean().optional().default(true) });

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query("select id, label, code, active, qr_token_version, updated_at from public.restaurant_tables order by code asc");
    return NextResponse.json({ tables: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_tables_list_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Tables could not be loaded." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Table data is invalid." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  let result;
  try {
    result = await query("select * from public.create_table_with_qr($1, $2, $3, $4, $5::uuid)", [parsed.data.label, parsed.data.code, parsed.data.active, hashOpaqueToken(rawToken), auth.actorId]);
  } catch (error) {
    const duplicate = databaseErrorCode(error) === "23505";
    return NextResponse.json({ error: duplicate ? "Table code already exists." : "Table could not be created." }, { status: duplicate ? 409 : 503, headers: noStoreHeaders() });
  }
  const data = result.rows[0];
  if (!data) return NextResponse.json({ error: "Table could not be created." }, { status: 503, headers: noStoreHeaders() });
  return NextResponse.json({ table: data, orderingUrl: `/order/t/${rawToken}` }, { status: 201, headers: noStoreHeaders() });
}
