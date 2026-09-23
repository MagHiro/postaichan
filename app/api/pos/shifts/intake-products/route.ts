import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

/** Tracked products needing an opening count, with last-known stock as hint. */
export async function GET() {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  try {
    const result = await query<{ id: string; name: string; stock_quantity: number }>(
      `select p.id, p.name, p.stock_quantity from public.products p
       where p.active = true and p.archived_at is null and p.stock_tracked = true
       order by p.display_order asc, p.name asc`,
    );
    return NextResponse.json({ products: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("shift_intake_products_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Daftar stok belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
