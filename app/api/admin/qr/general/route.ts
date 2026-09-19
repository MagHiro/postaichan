import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { databaseErrorCode, query } from "@/lib/db";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const schema = z.object({ label: z.string().trim().min(1).max(80) }).strict();

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query("select id, label, kind, active, token_version, created_at, updated_at from public.ordering_qr_codes order by created_at desc");
    return NextResponse.json({ codes: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("general_qr_list_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "QR umum belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Label QR umum wajib diisi." }, { status: 400, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "general-qr-create", 12, 900, auth.actorId ?? "dev"))) return NextResponse.json({ error: "Terlalu banyak pembuatan QR. Coba lagi nanti." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "900" } });
    const rawToken = createOpaqueToken(32);
    let result;
    try {
      result = await query("select * from public.create_general_qr($1, $2, $3::uuid)", [parsed.data.label, hashOpaqueToken(rawToken), auth.actorId]);
    } catch (error) {
      const duplicate = databaseErrorCode(error) === "23505";
      return NextResponse.json({ error: duplicate ? "Label QR sudah digunakan." : "QR umum belum dapat dibuat." }, { status: duplicate ? 409 : 503, headers: noStoreHeaders() });
    }
    const code = result.rows[0];
    if (!code) return NextResponse.json({ error: "QR umum belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
    return NextResponse.json({ code, orderingUrl: `/order/g/${rawToken}` }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("general_qr_create_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "QR umum belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
