import { randomUUID } from "node:crypto";

type SafeLogValue = string | number | boolean | null;
type SafeLogFields = Record<string, SafeLogValue>;

export function createRequestId() {
  return randomUUID();
}

export function structuredLog(level: "info" | "warn" | "error", event: string, requestId: string, fields: SafeLogFields = {}) {
  const record = JSON.stringify({ timestamp: new Date().toISOString(), level, event, requestId, ...fields });
  console[level](record);
}
