import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeStaff, authFailureMessage, authFailureStatus } from "@/lib/auth/authorize-staff";
import { query } from "@/lib/db";
import { loadReceiptSettings } from "@/lib/receipt-data";
import { readJsonBody, noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const uuid = z.string().regex(/^(?:[a-f\d]{4}|[a-f\d]{8}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})$/i);
const clean = (max: number) => z.string().max(max).refine(s => !/[\x00-\x1f\x7f]/.test(s), "Karakter tidak valid.");
const schema = z.object({
  merchant_name: clean(80).trim().min(1),
  address: clean(200),
  footer: clean(240),
  paper_width_mm: z.union([z.literal(58), z.literal(80)]),
  ble_service_uuid: uuid,
  ble_characteristic_uuid: uuid,
}).strict();

export async function GET() {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Admin diperlukan.", "Login diperlukan.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    return NextResponse.json({ settings: await loadReceiptSettings() }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "Pengaturan struk belum tersedia. Periksa migrasi database." }, { status: 503, headers: noStoreHeaders() });
  }
}

export async function PUT(request: Request) {
  const auth = await authorizeStaff("admin");
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Admin diperlukan.", "Login diperlukan.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Asal permintaan tidak valid." }, { status: 403, headers: noStoreHeaders() });
  const body = await readJsonBody(request);
  if (body instanceof Response) return body;
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Pengaturan struk tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const { merchant_name, address, footer, paper_width_mm, ble_service_uuid, ble_characteristic_uuid } = parsed.data;
    const result = await query(
      "select * from public.update_receipt_settings($1,$2,$3,$4,$5,$6,$7::uuid)",
      [merchant_name, address, footer, paper_width_mm, ble_service_uuid, ble_characteristic_uuid, auth.actorId],
    );
    return NextResponse.json({ settings: result.rows[0] }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "Pengaturan struk gagal disimpan." }, { status: 503, headers: noStoreHeaders() });
  }
}
