import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { customerSessionSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const parsed = customerSessionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Sesi pemesanan tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    if (!(await consumeRateLimit(request, "customer-session", 12, 300))) return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    let tableId: string | null = null;
    let tableLabel: string | null = null;
    let tableQrVersion: number | null = null;
    let orderingQrCodeId: string | null = null;
    let orderingQrTokenVersion: number | null = null;
    let sourceTableId: string | null = null;
    let sourceTableQrVersion: number | null = null;
    if (parsed.data.tableToken) {
      const tableResult = await query<{ id: string; label: string; active: boolean; qr_token_version: number }>("select id, label, active, qr_token_version from public.restaurant_tables where qr_token_hash = $1 limit 1", [hashOpaqueToken(parsed.data.tableToken)]);
      const table = tableResult.rows[0];
      if (!table?.active) return NextResponse.json({ error: "QR meja sudah tidak berlaku. Scan QR terbaru." }, { status: 410, headers: noStoreHeaders() });
      sourceTableId = table.id;
      sourceTableQrVersion = table.qr_token_version;
      if (parsed.data.orderType === "dine_in") {
        tableId = table.id;
        tableLabel = table.label;
        tableQrVersion = table.qr_token_version;
      }
    }
    if (parsed.data.generalToken) {
      const codeResult = await query<{ id: string; active: boolean; token_version: number }>("select id, active, token_version from public.ordering_qr_codes where token_hash = $1 limit 1", [hashOpaqueToken(parsed.data.generalToken)]);
      const code = codeResult.rows[0];
      if (!code?.active) return NextResponse.json({ error: "QR pemesanan sudah tidak berlaku. Scan QR terbaru." }, { status: 410, headers: noStoreHeaders() });
      orderingQrCodeId = code.id;
      orderingQrTokenVersion = code.token_version;
    }
    const rawToken = createOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await query(
      `insert into public.customer_sessions(access_token_hash, order_type, table_id, table_qr_version, source_table_id, source_table_qr_version, ordering_qr_code_id, ordering_qr_token_version, expires_at)
       values ($1, $2::public.order_type, $3, $4, $5, $6, $7, $8, $9)`,
      [hashOpaqueToken(rawToken), parsed.data.orderType, parsed.data.orderType === "dine_in" ? tableId : null, parsed.data.orderType === "dine_in" ? tableQrVersion : null, sourceTableId, sourceTableQrVersion, orderingQrCodeId, orderingQrTokenVersion, expiresAt],
    );
    return NextResponse.json({ sessionToken: rawToken, orderType: parsed.data.orderType, tableLabel: parsed.data.orderType === "dine_in" ? tableLabel : null, expiresAt, hasTable: parsed.data.orderType === "dine_in" && tableId !== null }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("customer_session_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Pesanan belum dapat dimulai. Scan QR terbaru lalu coba lagi." }, { status: 503, headers: noStoreHeaders() });
  }
}
