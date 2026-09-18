export type CreatePaymentInput = {
  providerOrderId: string;
  amountIdr: number;
  expiresAt: Date;
};

export type CreatePaymentResult = {
  providerTransactionId?: string;
  qrString?: string;
  qrImageUrl?: string;
  providerOrderId: string;
  expiresAt: Date;
};

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPaymentStatus(providerOrderId: string): Promise<"pending" | "settled" | "expired" | "failed">;
  expirePayment(providerOrderId: string): Promise<void>;
  refundPayment(providerOrderId: string, amountIdr: number, refundKey?: string): Promise<void>;
}
