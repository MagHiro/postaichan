import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from "./provider.ts";
import { parseMidtransIdrAmount, parseMidtransTimestamp } from "./midtrans-webhook.ts";
import { midtransExpiry } from "./midtrans-expiry.ts";
import { providerQrImageUrl } from "./qr.ts";

export type MidtransClientConfig = { serverKey: string; baseUrl: string };
type MidtransErrorKind = "not_configured" | "network" | "rejected" | "invalid_response" | "no_qr";

export class MidtransProviderError extends Error {
  readonly kind: MidtransErrorKind;
  readonly statusCode: number | null;
  readonly providerMessage: string | null;

  constructor(kind: MidtransErrorKind, statusCode: number | null, providerMessage: string | null) {
    super(`MIDTRANS_${kind.toUpperCase()}${statusCode ? `_${statusCode}` : ""}`);
    this.name = "MidtransProviderError";
    this.kind = kind;
    this.statusCode = statusCode;
    this.providerMessage = providerMessage;
  }
}

function providerMessage(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = body as { status_message?: unknown; validation_messages?: unknown };
  const messages = Array.isArray(value.validation_messages) ? value.validation_messages.filter((item): item is string => typeof item === "string") : [];
  const statusMessage = typeof value.status_message === "string" ? value.status_message : "";
  const message = [statusMessage, ...messages].filter(Boolean).join(" ").trim();
  return message ? message.slice(0, 220) : null;
}

async function responseBody(response: Response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; }
  catch { return { status_message: raw.slice(0, 220) }; }
}

export function describeMidtransError(error: unknown) {
  if (!(error instanceof MidtransProviderError)) return null;
  if (error.kind === "not_configured") return { code: "PAYMENT_CONFIGURATION_ERROR", error: "Konfigurasi Midtrans belum lengkap. Periksa MIDTRANS_SERVER_KEY dan environment Sandbox/Production.", status: 503, retryable: false };
  if (error.statusCode === 401 || error.statusCode === 403) return { code: "PAYMENT_PROVIDER_AUTH_ERROR", error: "Midtrans menolak kredensial pembayaran. Pastikan Server Key cocok dengan environment Sandbox/Production.", status: 503, retryable: false };
  if (error.kind === "rejected" && error.statusCode && error.statusCode < 500) return { code: "PAYMENT_PROVIDER_REJECTED", error: "Midtrans menolak pembuatan pembayaran. Periksa konfigurasi transaksi atau coba lagi.", status: error.statusCode === 409 ? 409 : 502, retryable: error.statusCode === 409 };
  if (error.kind === "no_qr") return { code: "PAYMENT_PROVIDER_NO_QR", error: "Midtrans menerima transaksi tetapi tidak mengembalikan QR. Coba lagi dengan tombol yang sama.", status: 503, retryable: true };
  if (error.kind === "invalid_response") return { code: "PAYMENT_PROVIDER_INVALID_RESPONSE", error: "Midtrans mengembalikan respons yang tidak lengkap. Coba lagi; pembayaran belum dapat ditampilkan.", status: 503, retryable: true };
  return { code: "PAYMENT_PROVIDER_UNAVAILABLE", error: "Midtrans tidak dapat dihubungi sekarang. Pembayaran belum dapat dibuat; coba lagi sebentar.", status: 503, retryable: true };
}

export class MidtransClient implements PaymentProvider {
  private readonly config: MidtransClientConfig;

  constructor(config: MidtransClientConfig) {
    this.config = config;
    if (!config.serverKey) throw new MidtransProviderError("not_configured", null, null);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const customExpiry = midtransExpiry(input);
    if (!customExpiry) throw new MidtransProviderError("rejected", 409, "expiry_window_too_short");
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v2/charge`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` },
        body: JSON.stringify({ payment_type: "qris", transaction_details: { order_id: input.providerOrderId, gross_amount: input.amountIdr }, custom_expiry: customExpiry, qris: { acquirer: "gopay" } }),
        cache: "no-store", signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new MidtransProviderError("network", null, null); }
    const responseData = await responseBody(response);
    if (!response.ok) throw new MidtransProviderError("rejected", response.status, providerMessage(responseData));
    const data = responseData as { transaction_id?: string; qr_string?: string; status_code?: string | number; expiry_time?: string; actions?: Array<{ name?: string; url?: string }> } | null;
    const qrImageUrl = data?.actions?.find((action) => action.name === "generate-qr-code-v2")?.url ?? data?.actions?.find((action) => action.name === "generate-qr-code")?.url;
    let safeQrImageUrl: string | undefined;
    if (qrImageUrl) {
      try { const parsed = new URL(qrImageUrl); if (providerQrImageUrl(parsed.toString())) safeQrImageUrl = parsed.toString(); }
      catch { safeQrImageUrl = undefined; }
    }
    if (!data || String(data.status_code) !== "201" || typeof data.transaction_id !== "string" || !data.transaction_id || data.transaction_id.length > 120) throw new MidtransProviderError("invalid_response", response.status, providerMessage(data));
    if (!data.qr_string && !safeQrImageUrl) throw new MidtransProviderError("no_qr", response.status, null);
    const providerExpiresAt = data.expiry_time ? parseMidtransTimestamp(data.expiry_time) : null;
    if (data.expiry_time && !providerExpiresAt) throw new MidtransProviderError("invalid_response", response.status, null);
    const orderTime = parseMidtransTimestamp(customExpiry.order_time);
    const scheduledExpiry = orderTime ? new Date(orderTime.getTime() + customExpiry.expiry_duration * 1000) : null;
    if (!providerExpiresAt && !scheduledExpiry) throw new MidtransProviderError("invalid_response", response.status, null);
    return { providerTransactionId: data.transaction_id, qrString: data.qr_string, qrImageUrl: safeQrImageUrl, providerOrderId: input.providerOrderId, expiresAt: input.expiresAt, providerExpiresAt: providerExpiresAt ?? scheduledExpiry };
  }

  async getPaymentStatus(providerOrderId: string) {
    let response: Response;
    try { response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/status`, { headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new MidtransProviderError("network", null, null); }
    const body = await responseBody(response);
    if (!response.ok) throw new MidtransProviderError("rejected", response.status, providerMessage(body));
    const data = body as { transaction_status?: string; transaction_id?: string; settlement_time?: string; refund_amount?: string; refunds?: Array<{ refund_key?: string; refund_amount?: string; created_at?: string }> } | null;
    if (!data?.transaction_status) throw new MidtransProviderError("invalid_response", response.status, providerMessage(body));
    const providerStatus = data.transaction_status;
    const refundAmountIdr = typeof data.refund_amount === "string" ? parseMidtransIdrAmount(data.refund_amount) ?? undefined : undefined;
    const refunds = Array.isArray(data.refunds) ? data.refunds.flatMap((item) => typeof item.refund_key === "string" ? [{ refundKey: item.refund_key, amountIdr: typeof item.refund_amount === "string" ? parseMidtransIdrAmount(item.refund_amount) : null, createdAt: parseMidtransTimestamp(item.created_at) ?? undefined }] : []) : [];
    const state = ["settlement", "capture"].includes(providerStatus) ? "settled"
      : ["expire", "cancel"].includes(providerStatus) ? "expired"
        : ["deny", "failure"].includes(providerStatus) ? "failed"
          : providerStatus === "refund" ? "refunded"
            : providerStatus === "partial_refund" ? "partially_refunded"
              : providerStatus === "pending" ? "pending" : "unknown";
    return { state, providerStatus, providerTransactionId: data.transaction_id, settlementTime: parseMidtransTimestamp(data.settlement_time) ?? undefined, refundAmountIdr, refundKeys: refunds.map((refund) => refund.refundKey), refunds } as const;
  }

  async expirePayment(providerOrderId: string) {
    let response: Response;
    try { response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/expire`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new MidtransProviderError("network", null, null); }
    if (response.status === 412 || response.status === 404 || !response.ok) {
      await responseBody(response);
      return { outcome: "status_required", statusCode: response.status } as const;
    }
    const body = await responseBody(response) as { transaction_status?: string } | null;
    if (body?.transaction_status === "expire" || body?.transaction_status === "cancel") return { outcome: "confirmed_expired", statusCode: response.status } as const;
    return { outcome: "status_required", statusCode: response.status } as const;
  }

  async refundPayment(providerTransactionId: string, amountIdr: number, refundKey: string) {
    if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) throw new MidtransProviderError("rejected", 400, "Jumlah refund tidak valid.");
    if (!providerTransactionId || providerTransactionId.length > 120) throw new MidtransProviderError("invalid_response", null, null);
    let response: Response;
    try { response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerTransactionId)}/refund`, { method: "POST", headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` }, body: JSON.stringify({ refund_key: refundKey, amount: amountIdr }), cache: "no-store", signal: AbortSignal.timeout(10_000) }); }
    catch { throw new MidtransProviderError("network", null, null); }
    if (!response.ok) {
      const body = await responseBody(response);
      if (response.status === 409 || /duplicate|already.*refund|refund.*exist/i.test(providerMessage(body) ?? "")) return { submitted: false, duplicate: true };
      throw new MidtransProviderError("rejected", response.status, providerMessage(body));
    }
    return { submitted: true, duplicate: false };
  }
}
