import { NextResponse } from "next/server";
import { z } from "zod";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { tableMutationSchema } from "@/lib/menu-schema";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const createSchema = tableMutationSchema.extend({ active: z.boolean().optional().default(true) });

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query("select id, label, code, active, qr_token_version, updated_at from public.restaurant_tables order by code asc");
    return NextResponse.json({ tables: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("admin_tables_list_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Meja belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Administrator authorization required.", "Authentication required.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Data meja belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  let result;
  try {
    result = await query("select * from public.create_table_with_qr($1, $2, $3, $4, $5::uuid)", [parsed.data.label, parsed.data.code, parsed.data.active, hashOpaqueToken(rawToken), auth.actorId]);
  } catch (error) {
    const duplicate = databaseErrorCode(error) === "23505";
    return NextResponse.json({ error: duplicate ? "Kode meja sudah digunakan." : "Meja belum dapat dibuat." }, { status: duplicate ? 409 : 503, headers: noStoreHeaders() });
  }
  const data = result.rows[0];
  if (!data) return NextResponse.json({ error: "Meja belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
  return NextResponse.json({ table: data, orderingUrl: `/?table=${rawToken}` }, { status: 201, headers: noStoreHeaders() });
}
