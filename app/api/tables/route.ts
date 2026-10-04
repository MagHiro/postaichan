import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

// Public active-table list for the customer walk-in meja picker.
// Labels are already printed on physical QRs, so no auth is required.
export async function GET() {
  try {
    const result = await query<{ id: string; label: string }>(
      "select id, label from public.restaurant_tables where active = true order by code asc",
    );
    return NextResponse.json({ tables: result.rows }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("public_tables_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Meja belum dapat dimuat." }, { status: 503, headers: noStoreHeaders() });
  }
}
