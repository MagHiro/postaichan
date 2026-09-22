import "server-only";
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from "./provider";
import { providerQrImageUrl } from "./qr";

type MidtransConfig = { serverKey: string; baseUrl: string };

type MidtransErrorKind = "not_configured" | "network" | "rejected" | "invalid_response" | "no_qr";

export class MidtransProviderError extends Error {
  constructor(
    public readonly kind: MidtransErrorKind,
    public readonly statusCode: number | null,
    public readonly providerMessage: string | null,
  ) {
    super(`MIDTRANS_${kind.toUpperCase()}${statusCode ? `_${statusCode}` : ""}${providerMessage ? `: ${providerMessage}` : ""}`);
    this.name = "MidtransProviderError";
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
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { status_message: raw.slice(0, 220) };
  }
}

export function describeMidtransError(error: unknown) {
  if (!(error instanceof MidtransProviderError)) return null;
  if (error.kind === "not_configured") return { code: "PAYMENT_CONFIGURATION_ERROR", error: "Konfigurasi Midtrans belum lengkap. Periksa MIDTRANS_SERVER_KEY dan environment Sandbox/Production.", status: 503, retryable: false };
  if (error.statusCode === 401 || error.statusCode === 403) return { code: "PAYMENT_PROVIDER_AUTH_ERROR", error: "Midtrans menolak kredensial pembayaran. Pastikan Server Key cocok dengan environment Sandbox/Production.", status: 503, retryable: false };
  if (error.kind === "rejected" && error.statusCode && error.statusCode < 500) return { code: "PAYMENT_PROVIDER_REJECTED", error: `Midtrans menolak pembayaran${error.providerMessage ? `: ${error.providerMessage}` : "."}`, status: error.statusCode === 409 ? 409 : 502, retryable: error.statusCode === 409 };
  if (error.kind === "no_qr") return { code: "PAYMENT_PROVIDER_NO_QR", error: "Midtrans menerima transaksi tetapi tidak mengembalikan QR. Coba lagi dengan tombol yang sama.", status: 503, retryable: true };
  if (error.kind === "invalid_response") return { code: "PAYMENT_PROVIDER_INVALID_RESPONSE", error: "Midtrans mengembalikan respons yang tidak lengkap. Coba lagi; pembayaran belum dapat ditampilkan.", status: 503, retryable: true };
  return { code: "PAYMENT_PROVIDER_UNAVAILABLE", error: "Midtrans tidak dapat dihubungi sekarang. Pembayaran belum dapat dibuat; coba lagi sebentar.", status: 503, retryable: true };
}

export class MidtransProvider implements PaymentProvider {
  constructor(private readonly config: MidtransConfig = {
    serverKey: process.env.MIDTRANS_SERVER_KEY ?? "",
    baseUrl: process.env.MIDTRANS_IS_PRODUCTION === "true" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com",
  }) {
    if (!config.serverKey) throw new MidtransProviderError("not_configured", null, null);
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v2/charge`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` },
        body: JSON.stringify({
          payment_type: "qris",
          transaction_details: { order_id: input.providerOrderId, gross_amount: input.amountIdr },
          // Keep the provider window identical to the app window (15 min) so the
          // QR the customer scans never outlives the countdown we display.
          custom_expiry: { expiry_duration: 15, unit: "minute" },
          qris: { acquirer: "gopay" },
        }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MidtransProviderError("network", null, null);
    }
    const responseData = await responseBody(response);
    if (!response.ok) throw new MidtransProviderError("rejected", response.status, providerMessage(responseData));
    const data = responseData as { transaction_id?: string; qr_string?: string; status_code?: string | number; actions?: Array<{ name?: string; url?: string }> } | null;
    // Midtrans returns status_code as "201" (string) in sandbox and 201
    // (number) in some production responses — compare loosely.
    const qrImageUrl = data?.actions?.find((action) => action.name === "generate-qr-code-v2")?.url ?? data?.actions?.find((action) => action.name === "generate-qr-code")?.url;
    let safeQrImageUrl: string | undefined;
    if (qrImageUrl) {
      try {
        const parsed = new URL(qrImageUrl);
        if (providerQrImageUrl(parsed.toString())) safeQrImageUrl = parsed.toString();
      } catch {
        safeQrImageUrl = undefined;
      }
    }
    if (!data || String(data.status_code) !== "201") throw new MidtransProviderError("invalid_response", response.status, providerMessage(data));
    if (!data.qr_string && !safeQrImageUrl) throw new MidtransProviderError("no_qr", response.status, null);
    return { providerTransactionId: data.transaction_id, qrString: data.qr_string, qrImageUrl: safeQrImageUrl, providerOrderId: input.providerOrderId, expiresAt: input.expiresAt };
  }

  async getPaymentStatus(providerOrderId: string) {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/status`, { headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new MidtransProviderError("network", null, null);
    }
    const body = await responseBody(response);
    if (!response.ok) throw new MidtransProviderError("rejected", response.status, providerMessage(body));
    const data = body as { transaction_status?: string } | null;
    if (!data?.transaction_status) throw new MidtransProviderError("invalid_response", response.status, providerMessage(body));
    if (["settlement", "capture"].includes(data.transaction_status ?? "")) return "settled" as const;
    if (["expire", "cancel"].includes(data.transaction_status ?? "")) return "expired" as const;
    if (["deny", "failure"].includes(data.transaction_status ?? "")) return "failed" as const;
    return "pending" as const;
  }

  async expirePayment(providerOrderId: string) {
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/expire`, {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MidtransProviderError("network", null, null);
    }
    if (!response.ok && response.status !== 412 && response.status !== 404) {
      const body = await responseBody(response);
      throw new MidtransProviderError("rejected", response.status, providerMessage(body));
    }
  }

  async refundPayment(providerOrderId: string, amountIdr: number, refundKey?: string) {
    if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) throw new MidtransProviderError("rejected", 400, "Jumlah refund tidak valid.");
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/refund`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` },
        body: JSON.stringify({ refund_key: refundKey ?? `refund-${providerOrderId}-${amountIdr}`, amount: amountIdr }),
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new MidtransProviderError("network", null, null);
    }
    if (!response.ok) {
      const body = await responseBody(response);
      throw new MidtransProviderError("rejected", response.status, providerMessage(body));
    }
  }
}
