import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkoutSchema } from "@/lib/schemas";
import { createProviderPayment } from "@/lib/payments/create-provider-payment";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { readJsonBody, consumeRateLimit, consumeIdentityRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";
import { checkoutDatabaseFailure, checkoutIntentMissing, checkoutQrMissing, checkoutUnexpectedFailure, invalidCheckoutInput } from "@/lib/domain/checkout-errors";
import { createRequestId, structuredLog } from "@/lib/security/structured-log";

export const runtime = "nodejs";

function fingerprint(input: { items: Array<{ productId: string; quantity: number; variantOptionIds: string[]; addonOptionIds: string[]; note?: string }> }) {
  const canonical = {
    items: input.items
      .map((item) => ({ ...item, variantOptionIds: [...item.variantOptionIds].sort(), addonOptionIds: [...item.addonOptionIds].sort() }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export async function POST(request: Request) {
  const requestId = createRequestId();
  const body = await readJsonBody(request);

  if (body instanceof Response) return body;

  const parsed = checkoutSchema.safeParse(body);
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
    // Bound distributed bursts in addition to the trusted-network and session
    // buckets; the database separately caps concurrent live QR reservations.
    if (!(await consumeIdentityRateLimit("checkout-global", "all", 240, 60))) {
      return NextResponse.json({ error: "Checkout sedang ramai. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } });
    }
    let intentResult;
    try {
      intentResult = await query<{ order_id: string; order_number: string; payment_id: string; payment_status: string; amount_idr: number; provider_order_id: string; qr_string: string | null; created_at: string | Date | null; expires_at: string | Date | null; replayed: boolean }>(
        `select * from public.create_checkout_intent($1::uuid, $2, $3, $4::uuid, $5::uuid, $6::public.payment_method, $7::jsonb)`,
        [input.idempotencyKey, fingerprint({ items: input.items }), sessionHash, null, null, "qris", JSON.stringify(input.items)],
      );
    } catch (error) {
      const failure = checkoutDatabaseFailure(error, "customer");
      return NextResponse.json(failure, { status: failure.status, headers: { ...noStoreHeaders(), ...(failure.code === "QR_RESERVATION_CAPACITY" ? { "Retry-After": "60" } : {}) } });
    }
    const intent = intentResult.rows[0];
    if (!intent) {
      const failure = checkoutIntentMissing();
      return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
    }
    if (intent.payment_status === "settled") {
      return NextResponse.json({ code: "ORDER_ALREADY_PAID", error: "Pesanan ini sudah lunas. Tidak perlu membuat pembayaran baru.", orderId: intent.order_id, orderNumber: intent.order_number, status: intent.payment_status }, { status: 409, headers: noStoreHeaders() });
    }
    let qrString: string | null = null;
    let qrImageUrl: string | null = null;
    let expiresAt = intent.expires_at ? new Date(intent.expires_at).toISOString() : null;
    if (intent.payment_status === "pending") {
      const providerPayment = await createProviderPayment(intent, requestId);
      if (!providerPayment.ok) return NextResponse.json({ ...providerPayment, orderId: intent.order_id }, { status: providerPayment.status, headers: noStoreHeaders() });
      qrString = providerPayment.qrString;
      qrImageUrl = providerPayment.qrImageUrl;
      expiresAt = providerPayment.expiresAt;
    }
    if (intent.payment_status === "pending" && !qrString && !qrImageUrl) {
      const failure = checkoutQrMissing(intent.order_id);
      return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
    }
    structuredLog("info", "checkout_completed", requestId, { orderId: intent.order_id, paymentId: intent.payment_id, paymentStatus: intent.payment_status, replayed: intent.replayed });
    return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, qrString, qrImageUrl, expiresAt, paymentId: intent.payment_id, status: intent.payment_status, replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    structuredLog("error", "checkout_failed", requestId, { errorType: error instanceof Error ? error.name : "unknown" });
    const failure = checkoutUnexpectedFailure("customer");
    return NextResponse.json(failure, { status: failure.status, headers: noStoreHeaders() });
  }
}
