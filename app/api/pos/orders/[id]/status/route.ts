import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { authFailureStatus, authorizeStaff } from "@/lib/auth/authorize-staff";
import { uuidParamSchema } from "@/lib/schemas";
import { describeMidtransError, MidtransProvider } from "@/lib/payments/midtrans";
import { noStoreHeaders, sameOrigin } from "@/lib/security/request";

export const runtime = "nodejs";
const statusSchema = z.object({ status: z.enum(["accepted", "processing", "ready", "completed", "cancelled"]) }).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeStaff();
  if (!auth.allowed) return NextResponse.json({ error: auth.authenticated ? "Staff authorization is insufficient." : "Staff authorization required." }, { status: authFailureStatus(auth), headers: noStoreHeaders() });
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const { id } = await params;
  if (!uuidParamSchema.safeParse(id).success) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 400, headers: noStoreHeaders() });
  const parsed = statusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Status pesanan tidak valid." }, { status: 400, headers: noStoreHeaders() });
  try {
    const current = await query<{ status: string; payment_status: string | null; provider: string | null; provider_order_id: string | null }>(
      `select o.status, p.status as payment_status, p.provider, p.provider_order_id
       from public.orders o
       left join lateral (select p.status, p.provider, p.provider_order_id from public.payments p where p.order_id = o.id order by p.created_at desc limit 1) p on true
       where o.id = $1`,
      [id],
    );
    if (!current.rows[0]) return NextResponse.json({ error: "Pesanan tidak ditemukan." }, { status: 404, headers: noStoreHeaders() });
    if (parsed.data.status === "cancelled") {
      if (!["draft", "awaiting_payment"].includes(current.rows[0].status)) {
        return NextResponse.json({ code: "ORDER_CANNOT_CANCEL", error: current.rows[0].payment_status === "settled" ? "Pesanan sudah lunas. Gunakan proses refund, bukan pembatalan." : "Pesanan sudah masuk proses operasional dan tidak dapat dibatalkan.", orderStatus: current.rows[0].status }, { status: 409, headers: noStoreHeaders() });
      }
      if (current.rows[0].payment_status === "settled") {
        return NextResponse.json({ code: "ORDER_CANNOT_CANCEL", error: "Pesanan sudah lunas. Gunakan proses refund, bukan pembatalan." }, { status: 409, headers: noStoreHeaders() });
      }
      if (current.rows[0].payment_status === "pending" && current.rows[0].provider === "midtrans" && current.rows[0].provider_order_id) {
        try {
          await new MidtransProvider().expirePayment(current.rows[0].provider_order_id);
        } catch (error) {
          const failure = describeMidtransError(error) ?? { code: "ORDER_CANCEL_PROVIDER_ERROR", error: "QR masih aktif di Midtrans, jadi pesanan belum dibatalkan. Coba lagi.", status: 503, retryable: true };
          return NextResponse.json({ ...failure, action: "cancel" }, { status: failure.status, headers: noStoreHeaders() });
        }
      }
    }
    const changed = await query<{ transition_order_status: boolean }>("select public.transition_order_status($1::uuid, $2::public.order_status, $3::public.order_status, $4::uuid) as transition_order_status", [id, current.rows[0].status, parsed.data.status, auth.actorId]);
    if (changed.rows[0]?.transition_order_status !== true) return NextResponse.json({ code: "ORDER_STATE_CHANGED", error: "Pesanan sudah berubah atau tidak dapat dipindahkan ke status itu." }, { status: 409, headers: noStoreHeaders() });
    return NextResponse.json({ ok: true, status: parsed.data.status }, { headers: noStoreHeaders() });
  } catch (error) {
    console.error("pos_order_status_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ code: "ORDER_STATUS_INTERNAL_ERROR", error: "Status pesanan belum dapat diperbarui karena server gagal menyimpan perubahan. Coba lagi.", retryable: true }, { status: 503, headers: noStoreHeaders() });
  }
}
