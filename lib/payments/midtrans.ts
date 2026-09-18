import "server-only";
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from "./provider";
import { providerQrImageUrl } from "./qr";

type MidtransConfig = { serverKey: string; baseUrl: string };

export class MidtransProvider implements PaymentProvider {
  constructor(private readonly config: MidtransConfig = {
    serverKey: process.env.MIDTRANS_SERVER_KEY ?? "",
    baseUrl: process.env.MIDTRANS_IS_PRODUCTION === "true" ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com",
  }) {
    if (!config.serverKey) throw new Error("Midtrans is not configured.");
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const response = await fetch(`${this.config.baseUrl}/v2/charge`, {
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
    if (!response.ok) throw new Error("Payment provider unavailable.");
    const data = (await response.json()) as { transaction_id?: string; qr_string?: string; status_code?: string | number; actions?: Array<{ name?: string; url?: string }> };
    // Midtrans returns status_code as "201" (string) in sandbox and 201
    // (number) in some production responses — compare loosely.
    const qrImageUrl = data.actions?.find((action) => action.name === "generate-qr-code-v2")?.url ?? data.actions?.find((action) => action.name === "generate-qr-code")?.url;
    let safeQrImageUrl: string | undefined;
    if (qrImageUrl) {
      try {
        const parsed = new URL(qrImageUrl);
        if (providerQrImageUrl(parsed.toString())) safeQrImageUrl = parsed.toString();
      } catch {
        safeQrImageUrl = undefined;
      }
    }
    if (String(data.status_code) !== "201" || (!data.qr_string && !safeQrImageUrl)) throw new Error("Payment provider returned no QR data.");
    return { providerTransactionId: data.transaction_id, qrString: data.qr_string, qrImageUrl: safeQrImageUrl, providerOrderId: input.providerOrderId, expiresAt: input.expiresAt };
  }

  async getPaymentStatus(providerOrderId: string) {
    const response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/status`, { headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Payment provider unavailable.");
    const data = await response.json() as { transaction_status?: string };
    if (["settlement", "capture"].includes(data.transaction_status ?? "")) return "settled" as const;
    if (["expire", "cancel"].includes(data.transaction_status ?? "")) return "expired" as const;
    if (["deny", "failure"].includes(data.transaction_status ?? "")) return "failed" as const;
    return "pending" as const;
  }

  async expirePayment(providerOrderId: string) {
    const response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/expire`, {
      method: "POST",
      headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok && response.status !== 412 && response.status !== 404) throw new Error("Payment expiry was rejected by provider.");
  }

  async refundPayment(providerOrderId: string, amountIdr: number, refundKey?: string) {
    if (!Number.isSafeInteger(amountIdr) || amountIdr <= 0) throw new Error("Refund amount is invalid.");
    const response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/refund`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` },
      body: JSON.stringify({ refund_key: refundKey ?? `refund-${providerOrderId}-${amountIdr}`, amount: amountIdr }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Payment refund was rejected by provider.");
  }
}
