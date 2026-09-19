import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { customerSessionSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = customerSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Order session is invalid." }, { status: 400, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "customer-session", 12, 300))) return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    const supabase = createAdminClient();
    let tableId: string | null = null;
    let tableLabel: string | null = null;
    let tableQrVersion: number | null = null;
    let orderingQrCodeId: string | null = null;
    let orderingQrTokenVersion: number | null = null;
    let sourceTableId: string | null = null;
    let sourceTableQrVersion: number | null = null;
    if (parsed.data.tableToken) {
      const { data: table, error } = await supabase.from("restaurant_tables").select("id, label, active, qr_token_version").eq("qr_token_hash", hashOpaqueToken(parsed.data.tableToken)).maybeSingle();
      if (error) throw error;
      if (!table?.active) return NextResponse.json({ error: "This table QR is no longer active." }, { status: 410, headers: noStoreHeaders() });
      sourceTableId = table.id;
      sourceTableQrVersion = table.qr_token_version;
      if (parsed.data.orderType === "dine_in") {
        tableId = table.id;
        tableLabel = table.label;
        tableQrVersion = table.qr_token_version;
      }
    }
    if (parsed.data.generalToken) {
      const { data: code, error } = await supabase.from("ordering_qr_codes").select("id, active, token_version").eq("token_hash", hashOpaqueToken(parsed.data.generalToken)).maybeSingle();
      if (error) throw error;
      if (!code?.active) return NextResponse.json({ error: "This ordering QR is no longer active." }, { status: 410, headers: noStoreHeaders() });
      orderingQrCodeId = code.id;
      orderingQrTokenVersion = code.token_version;
    }
    const rawToken = createOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("customer_sessions").insert({ access_token_hash: hashOpaqueToken(rawToken), order_type: parsed.data.orderType, table_id: parsed.data.orderType === "dine_in" ? tableId : null, table_qr_version: parsed.data.orderType === "dine_in" ? tableQrVersion : null, source_table_id: sourceTableId, source_table_qr_version: sourceTableQrVersion, ordering_qr_code_id: orderingQrCodeId, ordering_qr_token_version: orderingQrTokenVersion, expires_at: expiresAt });
    if (error) throw error;
    return NextResponse.json({ sessionToken: rawToken, orderType: parsed.data.orderType, tableLabel: parsed.data.orderType === "dine_in" ? tableLabel : null, expiresAt, hasTable: parsed.data.orderType === "dine_in" && tableId !== null }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("customer_session_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "We couldn't start this order. Please scan the QR again." }, { status: 503, headers: noStoreHeaders() });
  }
}
