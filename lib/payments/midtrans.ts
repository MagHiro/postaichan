import "server-only";
import type { CreatePaymentInput, CreatePaymentResult, PaymentProvider } from "./provider";

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
      body: JSON.stringify({ payment_type: "qris", transaction_details: { order_id: input.providerOrderId, gross_amount: input.amountIdr }, qris: { acquirer: "gopay" } }),
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Payment provider unavailable.");
    const data = await response.json() as { transaction_id?: string; qr_string?: string; status_code?: string };
    if (data.status_code !== "201" || !data.qr_string) throw new Error("Payment provider rejected the transaction.");
    return { providerTransactionId: data.transaction_id, qrString: data.qr_string, providerOrderId: input.providerOrderId, expiresAt: input.expiresAt };
  }

  async getPaymentStatus(providerOrderId: string) {
    const response = await fetch(`${this.config.baseUrl}/v2/${encodeURIComponent(providerOrderId)}/status`, { headers: { authorization: `Basic ${Buffer.from(`${this.config.serverKey}:`).toString("base64")}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Payment provider unavailable.");
    const data = await response.json() as { transaction_status?: string };
    if (["settlement", "capture"].includes(data.transaction_status ?? "")) return "settled" as const;
    if (["expire", "cancel"].includes(data.transaction_status ?? "")) return "expired" as const;
    if (["deny", "failure"].includes(data.transaction_status ?? "")) return "failed" as const;
    return "pending" as const;
  }

  async expirePayment(providerOrderId: string) { void providerOrderId; }
  async refundPayment(providerOrderId: string, amountIdr: number) { void providerOrderId; void amountIdr; }
}
