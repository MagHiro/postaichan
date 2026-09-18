import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { z } from "zod";

export const runtime = "nodejs";
const schema = z.object({ orderType: z.enum(["dine_in", "takeaway"]), tableToken: z.string().max(240).optional() });
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Order session is invalid." }, { status: 400 });
  try {
    const supabase = createAdminClient();
    let tableId: string | null = null;
    // Dine-in can be chosen freely (Meja No. optional). When a table QR token
    // is present we resolve it; otherwise the session stays table-less.
    if (parsed.data.tableToken) {
      // Preview tokens use the table code. Production QR tokens should be opaque/signed and resolved here.
      const tableCode = parsed.data.tableToken.match(/TBL-\d{2}/)?.[0];
      const { data: table } = tableCode ? await supabase.from("restaurant_tables").select("id, active").eq("code", tableCode).maybeSingle() : { data: null };
      if (!table?.active) return NextResponse.json({ error: "This table QR is no longer active." }, { status: 410 });
      tableId = table.id;
    }
    const rawToken = randomBytes(32).toString("base64url");
    const { error } = await supabase.from("customer_sessions").insert({ access_token_hash: hashToken(rawToken), order_type: parsed.data.orderType, table_id: tableId, expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() });
    if (error) throw error;
    return NextResponse.json({ sessionToken: rawToken, orderType: parsed.data.orderType, tableId });
  } catch (error) {
    console.error("customer_session_failed", error);
    return NextResponse.json({ error: "We couldn't start this order. Please scan the QR again." }, { status: 503 });
  }
}
