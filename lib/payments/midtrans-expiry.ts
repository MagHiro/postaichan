import type { CreatePaymentInput } from "./provider";

function formatJakartaOrderTime(value: Date) {
  if (Number.isNaN(value.getTime())) return null;
  const jakarta = new Date(value.getTime() + 7 * 60 * 60 * 1000);
  const part = (number: number) => String(number).padStart(2, "0");
  return `${jakarta.getUTCFullYear()}-${part(jakarta.getUTCMonth() + 1)}-${part(jakarta.getUTCDate())} ${part(jakarta.getUTCHours())}:${part(jakarta.getUTCMinutes())}:${part(jakarta.getUTCSeconds())} +0700`;
}

/** Provider expiry is anchored to the database payment creation timestamp. */
export function midtransExpiry(input: CreatePaymentInput, now = Date.now()) {
  const orderTime = formatJakartaOrderTime(input.createdAt);
  const spanSeconds = Math.floor((input.expiresAt.getTime() - input.createdAt.getTime()) / 1000);
  if (!orderTime || !Number.isSafeInteger(spanSeconds) || spanSeconds < 20 || input.expiresAt.getTime() - now < 20_000) return null;
  return { order_time: orderTime, expiry_duration: spanSeconds, unit: "second" as const };
}
