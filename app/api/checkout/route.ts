import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkoutSchema } from "@/lib/schemas";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { presentQrMaterial } from "@/lib/payments/qr";
import { hashOpaqueToken } from "@/lib/domain/tokens";
import { consumeRateLimit, noStoreHeaders } from "@/lib/security/request";

export const runtime = "nodejs";

function fingerprint(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function rpcErrorStatus(message: string) {
  if (message === "SESSION_EXPIRED") return 401;
  if (["MENU_CONFLICT", "INVALID_MODIFIERS", "INVALID_QUANTITY", "DUPLICATE_MODIFIER", "MONEY_LIMIT", "EMPTY_OR_LARGE_CART", "INVALID_NOTE"].includes(message)) return 409;
  if (["QRIS_DISABLED", "CASH_DISABLED", "CASH_NOT_GUEST", "ACTIVE_PAYMENT_EXISTS", "TAKEAWAY_TABLE_CONFLICT", "ORDER_TYPE_CONFLICT", "TABLE_NOT_AVAILABLE", "IDEMPOTENCY_KEY_REUSED"].includes(message)) return 409;
  return 503;
}

export async function POST(request: Request) {
  const parsed = checkoutSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pesanan belum lengkap. Periksa kembali item dan pilihanmu." }, { status: 400, headers: noStoreHeaders() });
  const input = parsed.data;
  try {
    const sessionHash = hashOpaqueToken(input.sessionToken);
    if (!(await consumeRateLimit(request, "checkout", 8, 60, sessionHash.slice(0, 24)))) {
      return NextResponse.json({ error: "Terlalu banyak percobaan. Coba lagi sebentar." }, { status: 429, headers: { ...noStoreHeaders(), "Retry-After": "60" } });
    }
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("create_checkout_intent", {
      p_idempotency_key: input.idempotencyKey,
      p_idempotency_fingerprint: fingerprint({ orderType: input.orderType, items: input.items }),
      p_session_hash: sessionHash,
      p_order_type: input.orderType,
      p_table_id: null,
      p_actor_id: null,
      p_payment_method: "qris",
      p_items: input.items,
    });
    if (error) {
      const message = String(error.message || "").split(":")[0];
      return NextResponse.json({ error: message === "MENU_CONFLICT" ? "Menu berubah. Periksa kembali keranjangmu." : message === "QRIS_DISABLED" ? "Pembayaran QRIS sedang tidak tersedia." : message === "ACTIVE_PAYMENT_EXISTS" ? "Masih ada pembayaran aktif. Lanjutkan pembayaran sebelumnya atau tunggu sampai kedaluwarsa." : "Kami belum bisa membuat pembayaran." }, { status: rpcErrorStatus(message), headers: noStoreHeaders() });
    }
    const intent = Array.isArray(data) ? data[0] : data;
    if (!intent) return NextResponse.json({ error: "Pembayaran belum dapat dibuat." }, { status: 503, headers: noStoreHeaders() });

    const { data: storedPayment, error: storedPaymentError } = await supabase.from("payments").select("qr_string").eq("id", intent.payment_id).maybeSingle();
    if (storedPaymentError) throw storedPaymentError;
    const storedQr = (storedPayment?.qr_string ?? intent.qr_string) as string | null;
    let { qrString, qrImageUrl } = presentQrMaterial(storedQr);
    let expiresAt = intent.expires_at as string | null;
    if (intent.payment_status === "pending" && !qrString && !qrImageUrl) {
      const { data: claimed, error: claimError } = await supabase.rpc("claim_payment_provider_create", { p_payment_id: intent.payment_id });
      if (claimError) throw claimError;
      if (claimed === true) {
        try {
          const providerPayment = await new MidtransProvider().createPayment({ providerOrderId: intent.provider_order_id, amountIdr: intent.amount_idr, expiresAt: new Date(intent.expires_at) });
          const { error: updateError } = await supabase.from("payments").update({ provider_transaction_id: providerPayment.providerTransactionId ?? null, qr_string: providerPayment.qrString ?? providerPayment.qrImageUrl ?? null, expires_at: providerPayment.expiresAt.toISOString(), provider_created_at: new Date().toISOString(), provider_error: null, provider_creation_claimed_at: null }).eq("id", intent.payment_id).eq("status", "pending");
          if (updateError) throw updateError;
          qrString = providerPayment.qrString ?? null;
          qrImageUrl = providerPayment.qrImageUrl ?? null;
          expiresAt = providerPayment.expiresAt.toISOString();
        } catch (providerError) {
          await supabase.rpc("release_payment_provider_create", { p_payment_id: intent.payment_id, p_error: providerError instanceof Error ? providerError.message : "provider_error" });
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
