const MIDTRANS_QR_HOSTS = new Set(["api.midtrans.com", "api.sandbox.midtrans.com"]);

export function providerQrImageUrl(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && MIDTRANS_QR_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function presentQrMaterial(value: unknown) {
  const qrImageUrl = providerQrImageUrl(value);
  return { qrString: qrImageUrl ? null : typeof value === "string" ? value : null, qrImageUrl };
}
