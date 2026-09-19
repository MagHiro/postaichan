import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { tableMutationSchema } from "@/lib/menu-schema";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const createSchema = tableMutationSchema.extend({ active: z.boolean().optional().default(true) });

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  const { data, error } = await createAdminClient().from("restaurant_tables").select("id, label, code, active, qr_token_version, updated_at").order("code", { ascending: true });
  if (error) return NextResponse.json({ error: "Tables could not be loaded." }, { status: 503, headers: noStoreHeaders() });
  return NextResponse.json({ tables: data ?? [] }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Administrator authorization required." : "Authentication required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Table data is invalid." }, { status: 400, headers: noStoreHeaders() });
  const rawToken = createOpaqueToken(32);
  const supabase = createAdminClient();
  const { data: created, error } = await supabase.rpc("create_table_with_qr", { p_label: parsed.data.label, p_code: parsed.data.code, p_active: parsed.data.active, p_token_hash: hashOpaqueToken(rawToken), p_actor_id: auth.actorId });
  if (error) return NextResponse.json({ error: error.code === "23505" ? "Table code already exists." : "Table could not be created." }, { status: error.code === "23505" ? 409 : 503, headers: noStoreHeaders() });
  const data = Array.isArray(created) ? created[0] : created;
  if (!data) return NextResponse.json({ error: "Table could not be created." }, { status: 503, headers: noStoreHeaders() });
  return NextResponse.json({ table: data, orderingUrl: `/order/t/${rawToken}` }, { status: 201, headers: noStoreHeaders() });
}
