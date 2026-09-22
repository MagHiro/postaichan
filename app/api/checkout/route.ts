import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkoutSchema } from "@/lib/schemas";
import { presentQrMaterial } from "@/lib/payments/qr";
import { describeMidtransError, MidtransProvider } from "@/lib/payments/midtrans";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { checkoutDatabaseFailure, checkoutIntentMissing, checkoutQrMissing, checkoutUnexpectedFailure, invalidCheckoutInput } from "@/lib/domain/checkout-errors";

export const runtime = "nodejs";

function fingerprint(input: { orderType: string; items: Array<{ productId: string; quantity: number; variantOptionIds: string[]; addonOptionIds: string[]; note?: string }> }) {
  const canonical = {
    orderType: input.orderType,
    items: input.items
      .map((item) => ({ ...item, variantOptionIds: [...item.variantOptionIds].sort(), addonOptionIds: [...item.addonOptionIds].sort() }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const failure = invalidCheckoutInput(parsed.error.issues[0]);
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
  if (!sameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const sessionHash = hashOpaqueToken(input.sessionToken);
    if (!(await consumeRateLimit(request, "checkout", 8, 60, sessionHash.slice(0, 24)))) {
      return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } });
    }
    let intentResult;
    try {
      intentResult = await query<{ order_id: string; order_number: string; payment_id: string; payment_status: string; amount_idr: number; provider_order_id: string; qr_string: string | null; expires_at: string | null; replayed: boolean }>(
        `select * from public.create_checkout_intent($1::uuid, $2, $3, $4::public.order_type, $5::uuid, $6::uuid, $7::public.payment_method, $8::jsonb)`,
        [input.idempotencyKey, fingerprint({ orderType: input.orderType, items: input.items }), sessionHash, input.orderType, null, null, "qris", JSON.stringify(input.items)],
      );
    } catch (error) {
      const failure = checkoutDatabaseFailure(error, "customer");
      return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
    }
    const intent = intentResult.rows[0];
    if (!intent) {
      const failure = checkoutIntentMissing();
      return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
    }
    if (intent.payment_status === "settled") {
      return NextResponse.json({ code: "ORDER_ALREADY_PAID", error: "Pesanan ini sudah lunas. Tidak perlu membuat pembayaran baru.", orderId: intent.order_id, orderNumber: intent.order_number, status: intent.payment_status }, { status: 409, headers: noStoreHeaders() });
    }
    const storedPayment = await query<{ qr_string: string | null }>("select qr_string from public.payments where id = $1", [intent.payment_id]);
    const storedQr = storedPayment.rows[0]?.qr_string ?? intent.qr_string;
    let { qrString, qrImageUrl } = presentQrMaterial(storedQr);
    let expiresAt = intent.expires_at as string | null;
    if (intent.payment_status === "pending" && !qrString && !qrImageUrl) {
      const claimed = await query<{ claimed: boolean }>("select public.claim_payment_provider_create($1) as claimed", [intent.payment_id]);
      if (claimed.rows[0]?.claimed === true) {
        try {
          if (!intent.expires_at) throw new Error("PAYMENT_EXPIRY_MISSING");
          const providerPayment = await new MidtransProvider().createPayment({ providerOrderId: intent.provider_order_id, amountIdr: intent.amount_idr, expiresAt: new Date(intent.expires_at) });
          await query(
            `update public.payments
             set provider_transaction_id = $2, qr_string = $3, expires_at = $4, provider_created_at = $5,
                 provider_error = null, provider_creation_claimed_at = null, updated_at = timezone('utc', now())
             where id = $1 and status = 'pending'`,
            [intent.payment_id, providerPayment.providerTransactionId ?? null, providerPayment.qrString ?? providerPayment.qrImageUrl ?? null, providerPayment.expiresAt.toISOString(), new Date().toISOString()],
          );
          qrString = providerPayment.qrString ?? null;
          qrImageUrl = providerPayment.qrImageUrl ?? null;
          expiresAt = providerPayment.expiresAt.toISOString();
      } catch (providerError) {
        await query("select public.release_payment_provider_create($1, $2)", [intent.payment_id, providerError instanceof Error ? providerError.message : "provider_error"]);
        const failure = describeMidtransError(providerError) ?? (providerError instanceof Error && providerError.message === "PAYMENT_EXPIRY_MISSING"
          ? { code: "PAYMENT_EXPIRY_MISSING", error: "Waktu berlaku pembayaran tidak tersedia. Pesanan belum dibuatkan QR; coba lagi.", status: 503, retryable: true }
          : checkoutUnexpectedFailure("customer"));
        return NextResponse.json({ ...failure, orderId: intent.order_id }, { status: failure.status, headers: noStoreHeaders() });
      }
      } else {
        return NextResponse.json({ code: "PAYMENT_PREPARING", error: "Pembayaran sedang diklaim oleh proses lain. Jangan buat pesanan baru; tekan Bayar lagi dalam beberapa detik.", retryable: true, action: "retry", orderId: intent.order_id }, { status: 503, headers: noStoreHeaders() });
      }
    }
    if (intent.payment_status === "pending" && !qrString && !qrImageUrl) {
      const failure = checkoutQrMissing(intent.order_id);
      return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
    }
    return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, qrString, qrImageUrl, expiresAt, paymentId: intent.payment_id, status: intent.payment_status, replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("checkout_failed", error instanceof Error ? error.message : "unknown");
    const failure = checkoutUnexpectedFailure("customer");
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
}
