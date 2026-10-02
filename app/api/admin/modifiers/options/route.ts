import { NextResponse } from "next/server";
import { databaseErrorCode, query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { modifierOptionMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

async function adminAuth() { return authorizeStaff("admin"); }

function failure(auth: Awaited<ReturnType<typeof authorizeStaff>>) {
  return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  const auth = await adminAuth();
  if (!auth.allowed) return failure(auth);
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = modifierOptionMutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Data opsi belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const result = await query<{ create_modifier_option: string }>(
      "select public.create_modifier_option($1, $2::uuid, $3, $4, $5, $6, $7, $8::uuid) as create_modifier_option",
      [input.kind, input.groupId, input.name, input.priceAdjustmentIdr ?? 0, input.costAdjustmentIdr ?? 0, input.available ?? true, input.displayOrder ?? 0, auth.actorId],
    );
    const optionId = result.rows[0]?.create_modifier_option;
    if (!optionId) return NextResponse.json({ error: "Opsi belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
    return NextResponse.json({ optionId }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    if (databaseErrorCode(error) === "23505") return NextResponse.json({ error: "Nama opsi sudah dipakai di grup ini." }, { status: 409, headers: noStoreHeaders() });
    const message = error instanceof Error ? error.message.split(":")[0] : "";
    if (message === "INVALID_MODIFIER") return NextResponse.json({ error: "Data opsi belum lengkap atau tidak valid." }, { status: 400, headers: noStoreHeaders() });
    console.error("admin_modifier_option_create_failed", message || "unknown");
    return NextResponse.json({ error: "Opsi belum berhasil dibuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
