import { createHash, timingSafeEqual } from "node:crypto";

/** Midtrans sends IDR amounts as integer strings or fixed two-decimal strings. */
export function parseMidtransIdrAmount(value: string): number | null {
  if (!/^(?:0|[1-9]\d{0,15})(?:\.(\d{2}))?$/.test(value)) return null;
  const [whole, fraction = "00"] = value.split(".");
  if (fraction !== "00") return null;
  const amount = Number(whole);
  return Number.isSafeInteger(amount) ? amount : null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue((value as Record<string, unknown>)[key]);
    return result;
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalValue(value));
}

export function midtransEventIdentity(event: { order_id: string; transaction_id?: string; transaction_status: string; [key: string]: unknown }) {
  const payloadDigest = createHash("sha256").update(canonicalJson(event)).digest("hex");
  const semanticIdentity = `${event.transaction_id ?? event.order_id}:${event.transaction_status}`;
  return createHash("sha256").update(`${semanticIdentity}:${payloadDigest}`).digest("hex");
}

/** Midtrans timestamps without an offset are WIB (Asia/Jakarta, GMT+7). */
export function parseMidtransTimestamp(value: unknown): Date | null {
  if (typeof value !== "string" || value.length > 80 || value !== value.trim()) return null;
  const calendar = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (calendar) {
    const year = Number(calendar[1]); const month = Number(calendar[2]); const day = Number(calendar[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  }
  let normalized = value;
  const local = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/.exec(value);
  if (local) normalized = `${local[1]}T${local[2]}${local[3] ? `.${local[3].padEnd(3, "0")}` : ""}+07:00`;
  else {
    const offsetSpace = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2}:?\d{2})$/.exec(value);
    if (offsetSpace) normalized = `${offsetSpace[1]}T${offsetSpace[2]}${offsetSpace[3].includes(":") ? offsetSpace[3] : `${offsetSpace[3].slice(0, 3)}:${offsetSpace[3].slice(3)}`}`;
  }
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) return null;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function midtransSignature(orderId: string, statusCode: string, grossAmount: string, serverKey: string) {
  return createHash("sha512").update(`${orderId}${statusCode}${grossAmount}${serverKey}`).digest("hex");
}

export function verifyMidtransSignature(input: { order_id: string; status_code: string; gross_amount: string; signature_key: string }, serverKey: string) {
  const expected = Buffer.from(midtransSignature(input.order_id, input.status_code, input.gross_amount, serverKey), "utf8");
  const supplied = Buffer.from(input.signature_key, "utf8");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
