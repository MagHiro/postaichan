import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createOpaqueToken, hashOpaqueToken } from "@/lib/domain/tokens";
import { readJsonBody, consumeRateLimit, consumeIdentityRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { customerSessionSchema } from "@/lib/schemas";
import { getServerConfig } from "@/lib/config";
import { canStartCustomerSession } from "@/lib/security/public-ordering";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = customerSessionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Sesi pemesanan tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const config = getServerConfig();
    const hasQrToken = Boolean(parsed.data.tableToken || parsed.data.generalToken);
    if (!canStartCustomerSession(config.requireOrderingQr, parsed.data.tableToken, parsed.data.generalToken)) return NextResponse.json({ code: "ORDERING_QR_REQUIRED", error: "Scan QR meja atau QR pemesanan sebelum memulai pesanan." }, { status: 403, headers: noStoreHeaders() });
    if (!(await consumeRateLimit(request, "customer-session-network", 30, 300))
      || !(await consumeIdentityRateLimit("customer-session-global", "all", 1200, 300))) {
      return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    }
    const qrIdentity = parsed.data.tableToken ?? parsed.data.generalToken;
    if (qrIdentity && !(await consumeIdentityRateLimit("customer-session-qr", hashOpaqueToken(qrIdentity), 50, 300))) {
      return NextResponse.json({ error: "QR ini terlalu sering digunakan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    }
    if (parsed.data.tableId && !(await consumeIdentityRateLimit("customer-session-table", parsed.data.tableId, 80, 300))) {
      return NextResponse.json({ error: "Meja ini terlalu sering digunakan untuk memulai sesi. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    }
    if (!hasQrToken && !parsed.data.tableId && !(await consumeIdentityRateLimit("customer-session-open-global", "all", 120, 300))) {
      return NextResponse.json({ error: "Terlalu banyak sesi anonim dibuat. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "300" } });
    }
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
      tableId = table.id;
      tableLabel = table.label;
      tableQrVersion = table.qr_token_version;
    }
    if (parsed.data.generalToken) {
      const codeResult = await query<{ id: string; active: boolean; token_version: number }>("select id, active, token_version from public.ordering_qr_codes where token_hash = $1 limit 1", [hashOpaqueToken(parsed.data.generalToken)]);
      const code = codeResult.rows[0];
      if (!code?.active) return NextResponse.json({ error: "QR pemesanan sudah tidak berlaku. Scan QR terbaru." }, { status: 410, headers: noStoreHeaders() });
      orderingQrCodeId = code.id;
      orderingQrTokenVersion = code.token_version;
    }
    if (parsed.data.tableId) {
      const manualResult = await query<{ id: string; label: string; active: boolean; qr_token_version: number }>("select id, label, active, qr_token_version from public.restaurant_tables where id = $1 limit 1", [parsed.data.tableId]);
      const manual = manualResult.rows[0];
      if (!manual?.active) return NextResponse.json({ error: "Meja yang dipilih sudah tidak aktif. Pilih meja lain atau lanjut tanpa meja." }, { status: 410, headers: noStoreHeaders() });
      tableId = manual.id;
      tableLabel = manual.label;
      tableQrVersion = manual.qr_token_version;
    }
    const rawToken = createOpaqueToken(32);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    await query("select * from public.cleanup_stale_sessions_and_rate_limits()");
    await query(
      `insert into public.customer_sessions(access_token_hash, order_type, table_id, table_qr_version, source_table_id, source_table_qr_version, ordering_qr_code_id, ordering_qr_token_version, expires_at)
       values ($1, 'dine_in'::public.order_type, $2, $3, $4, $5, $6, $7, $8)`,
      [hashOpaqueToken(rawToken), tableId, tableQrVersion, sourceTableId, sourceTableQrVersion, orderingQrCodeId, orderingQrTokenVersion, expiresAt],
    );
    return NextResponse.json({ sessionToken: rawToken, tableLabel, expiresAt, hasTable: tableId !== null }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("customer_session_failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Pesanan belum dapat dimulai. Scan QR terbaru lalu coba lagi." }, { status: 503, headers: noStoreHeaders() });
  }
}
