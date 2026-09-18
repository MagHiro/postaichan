import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { consumeRateLimit, noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";
const schema = z.object({ orderType: z.enum(["dine_in", "takeaway"]), tableToken: z.string().trim().min(32).max(240).optional() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Order session is invalid." }, { status: 400, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "customer-session", 12, 300))) return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    const supabase = createAdminClient();
    let tableId: string | null = null;
    let tableLabel: string | null = null;
    let tableQrVersion: number | null = null;
    if (parsed.data.tableToken) {
      const { data: table, error } = await supabase.from("restaurant_tables").select("id, label, active, qr_token_version").eq("qr_token_hash", hashOpaqueToken(parsed.data.tableToken)).maybeSingle();
      if (error) throw error;
      if (!table?.active) return NextResponse.json({ error: "This table QR is no longer active." }, { status: 410, headers: noStoreHeaders() });
      tableId = table.id;
      tableLabel = table.label;
      tableQrVersion = table.qr_token_version;
    }
    const rawToken = createOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const { error } = await supabase.from("customer_sessions").insert({ access_token_hash: hashOpaqueToken(rawToken), order_type: parsed.data.orderType, table_id: parsed.data.orderType === "dine_in" ? tableId : null, table_qr_version: parsed.data.orderType === "dine_in" ? tableQrVersion : null, expires_at: expiresAt });
    if (error) throw error;
    return NextResponse.json({ sessionToken: rawToken, orderType: parsed.data.orderType, tableLabel: parsed.data.orderType === "dine_in" ? tableLabel : null, expiresAt }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("customer_session_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "We couldn't start this order. Please scan the QR again." }, { status: 503, headers: noStoreHeaders() });
  }
}
