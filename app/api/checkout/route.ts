import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkoutSchema } from "@/lib/schemas";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { consumeRateLimit, noStoreHeaders, sameOrigin } from "@/lib/security/request";

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

function rpcErrorStatus(message: string) {
  if (message === "SESSION_EXPIRED") return 401;
  if (["MENU_CONFLICT", "INVALID_MODIFIERS", "INVALID_QUANTITY", "DUPLICATE_MODIFIER", "MONEY_LIMIT", "EMPTY_OR_LARGE_CART", "INVALID_NOTE", "STOCK_CONFLICT"].includes(message)) return 409;
  if (["QRIS_DISABLED", "CASH_DISABLED", "CASH_NOT_GUEST", "ACTIVE_PAYMENT_EXISTS", "TAKEAWAY_TABLE_CONFLICT", "ORDER_TYPE_CONFLICT", "TABLE_NOT_AVAILABLE", "QR_NOT_AVAILABLE", "IDEMPOTENCY_KEY_REUSED"].includes(message)) return 409;
  return 503;
}

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pesanan belum lengkap. Periksa kembali item dan pilihanmu." }, { status: 400, headers: noStoreHeaders() });
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
        [input.idempotencyKey, fingerprint({ orderType: input.orderType, items: input.items }), sessionHash, input.orderType, null, null, "qris", input.items],
      );
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "";
      const message = rawMessage.split(":")[0];
      const stockProduct = message === "STOCK_CONFLICT" ? rawMessage.slice("STOCK_CONFLICT:".length).trim().slice(0, 120) : "";
      return NextResponse.json({ error: message === "MENU_CONFLICT" ? "Menu berubah. Periksa kembali keranjangmu." : message === "STOCK_CONFLICT" ? stockProduct ? `Stok ${stockProduct} berubah. Kurangi jumlah item lalu coba lagi.` : "Stok berubah. Kurangi jumlah item lalu coba lagi." : message === "QRIS_DISABLED" ? "Pembayaran QRIS sedang tidak tersedia." : message === "ACTIVE_PAYMENT_EXISTS" ? "Masih ada pembayaran aktif. Lanjutkan pembayaran sebelumnya atau tunggu sampai kedaluwarsa." : message === "TABLE_NOT_AVAILABLE" ? "QR meja sudah tidak berlaku. Scan QR terbaru." : message === "QR_NOT_AVAILABLE" ? "QR ini sudah tidak berlaku. Scan QR terbaru." : "Kami belum bisa membuat pembayaran." }, { status: rpcErrorStatus(message), headers: noStoreHeaders() });
    }
    const intent = intentResult.rows[0];
    if (!intent) return NextResponse.json({ error: "Pembayaran belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });
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
          return NextResponse.json({ error: "Pembayaran QRIS belum dapat dibuat. Coba lagi dengan tombol yang sama.", retryable: true, orderId: intent.order_id }, { status: 503, headers: noStoreHeaders() });
        }
      } else {
        return NextResponse.json({ error: "Pembayaran sedang disiapkan. Coba lagi sebentar dengan tombol yang sama.", retryable: true, orderId: intent.order_id }, { status: 503, headers: noStoreHeaders() });
      }
    }
    return NextResponse.json({ orderId: intent.order_id, orderNumber: intent.order_number, totalIdr: intent.amount_idr, qrString, qrImageUrl, expiresAt, paymentId: intent.payment_id, status: intent.payment_status, replayed: intent.replayed }, { status: intent.replayed ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    console.error("checkout_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Kami belum bisa membuat pembayaran. Coba lagi sebentar." }, { status: 503, headers: noStoreHeaders() });
  }
}
