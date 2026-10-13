import { NextResponse } from "next/server";
import { authFailureMessage, authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { query } from "@/lib/db";
import { uuidParamSchema } from "@/lib/schemas";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";

// Only authenticated, active staff can attest that the merchant received payment.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff("operator");
  if (!auth.allowed) return NextResponse.json(
    { error: authFailureMessage(auth, "Staff authorization is insufficient.", "Staff authorization required.") },
    { status: authFailureStatus(auth), headers: noStoreHeaders() },
  );
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Pesanan tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const result = await query<{ payment_status: string; order_status: string; already_verified: boolean }>(
      "select * from public.verify_manual_qris_payment($1::uuid, $2::uuid)",
      [id, auth.actorId],
    );
    const verified = result.rows[0];
    if (!verified) throw new Error("MANUAL_QRIS_VERIFICATION_MISSING");
    return NextResponse.json({
      paymentStatus: verified.payment_status, orderStatus: verified.order_status,
      alreadyVerified: verified.already_verified,
    }, { headers: noStoreHeaders() });
  } catch (error) {
    const code = error instanceof Error ? error.message : "UNKNOWN";
    const clientError = ["NOT_MANUAL_QRIS", "MANUAL_QRIS_NO_LONGER_PENDING", "CASHIER_SHIFT_CLOSED", "ORDER_NOT_FOUND", "MANUAL_QRIS_INVENTORY_CONFLICT"].find((name) => code.includes(name));
    return NextResponse.json({
      code: clientError ?? "MANUAL_QRIS_VERIFICATION_FAILED",
      error: clientError === "CASHIER_SHIFT_CLOSED" ? "Buka shift kasir sebelum verifikasi." :
        clientError === "MANUAL_QRIS_NO_LONGER_PENDING" ? "Pembayaran tidak lagi menunggu verifikasi." :
        clientError === "MANUAL_QRIS_INVENTORY_CONFLICT" ? "Stok tidak tersedia. Verifikasi dibatalkan, periksa pesanan." :
        clientError ? "Pesanan ini tidak dapat diverifikasi sebagai QRIS manual." :
        "Verifikasi belum berhasil. Status pembayaran tidak berubah.",
    }, { status: clientError ? 409 : 503, headers: noStoreHeaders() });
  }
}
