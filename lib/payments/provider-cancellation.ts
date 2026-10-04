import type { PaymentProvider, ProviderPaymentStatus } from "./provider";

/** Resolve ambiguous expiry responses through the provider's authoritative status endpoint. */
export async function providerStateBeforeCancellation(provider: PaymentProvider, providerOrderId: string): Promise<ProviderPaymentStatus> {
  try {
    const result = await provider.expirePayment(providerOrderId);
    if (result.outcome === "confirmed_expired") return { state: "expired", providerStatus: "expire" };
  } catch {
    // A timeout can occur after Midtrans processed the expiry request. Resolve
    // the state from the status endpoint before deciding whether local state
    // or inventory can change.
  }
  return provider.getPaymentStatus(providerOrderId);
}
