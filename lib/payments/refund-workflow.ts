import "server-only";
import { query } from "@/lib/db";
import { MidtransProvider } from "@/lib/payments/midtrans";
import { processRefundAttemptCore, reconcileRefundAttemptCore, type RefundOutcome } from "./refund-workflow-core";

export type { RefundOutcome } from "./refund-workflow-core";

export async function processRefundAttempt(input: {
  paymentId: string;
  amountIdr: number;
  reason: string;
  idempotencyKey: string;
  actorId: string;
  requestId?: string;
}): Promise<RefundOutcome> {
  return processRefundAttemptCore(input, { query, provider: new MidtransProvider() });
}

export async function reconcileRefundAttempt(attemptId: string, actorId: string, requestId?: string): Promise<RefundOutcome> {
  return reconcileRefundAttemptCore(attemptId, actorId, { query, provider: new MidtransProvider() }, requestId);
}
