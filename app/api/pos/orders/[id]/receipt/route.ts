import { NextResponse } from "next/server";
import { authorizeStaff, authFailureMessage, authFailureStatus } from "@/lib/auth/authorize-staff";
import { loadReceipt } from "@/lib/receipt-data";
import { uuidParamSchema } from "@/lib/schemas";
import { noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: authFailureMessage(auth, "Staff diperlukan.", "Login diperlukan.") }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  try {
    const receipt = await loadReceipt(id);
    if (!receipt) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    return NextResponse.json({ receipt }, { headers: noStoreHeaders() });
  } catch {
    return NextResponse.json({ error: "Struk belum bisa dimuat. Pastikan migrasi terbaru sudah dijalankan." }, { status: 503, headers: noStoreHeaders() });
  }
}
