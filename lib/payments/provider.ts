export type CreatePaymentInput = {
  providerOrderId: string;
  amountIdr: number;
  createdAt: Date;
  expiresAt: Date;
};

export type CreatePaymentResult = {
  providerTransactionId?: string;
  qrString?: string;
  qrImageUrl?: string;
  providerOrderId: string;
  expiresAt: Date;
  providerExpiresAt: Date | null;
};

export type ProviderPaymentStatus = {
  state: "pending" | "settled" | "expired" | "failed" | "refunded" | "partially_refunded" | "unknown";
  providerStatus: string;
  providerTransactionId?: string;
  settlementTime?: Date;
  refundAmountIdr?: number;
  refundKeys?: string[];
  refunds?: Array<{ refundKey: string; amountIdr: number | null; createdAt?: Date }>;
};

export type ExpirePaymentResult = { outcome: "confirmed_expired" | "status_required"; statusCode: number };

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  getPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus>;
  expirePayment(providerOrderId: string): Promise<ExpirePaymentResult>;
  refundPayment(providerTransactionId: string, amountIdr: number, refundKey: string): Promise<{ submitted: boolean; duplicate: boolean }>;
}
