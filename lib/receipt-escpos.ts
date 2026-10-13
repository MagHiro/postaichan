import type { ReceiptData } from "./receipt-types";

// The Web Bluetooth API accepts 16/32-bit assigned numbers as a number,
// whereas full 128-bit custom UUIDs are passed as their canonical string.
export function bluetoothUuid(value: string): number | string {
  return /^[a-f\\d]{4}(?:[a-f\\d]{4})?$/i.test(value) ? Number.parseInt(value, 16) : value;
}

// ESC/POS command bytes are only for Bluetooth LE printers that expose a
// writable GATT characteristic. They do not work with classic Bluetooth SPP.
export function formatEscPos(receipt: ReceiptData): Uint8Array {
  const width = receipt.settings.paper_width_mm === 80 ? 48 : 32;
  const clean = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
  const wrap = (s: string) => {
    const chunks: string[] = [];
    let rest = clean(s);
    while (rest.length > width) {
      const end = rest.lastIndexOf(" ", width);
      const index = end > width / 2 ? end : width;
      chunks.push(rest.slice(0, index));
      rest = rest.slice(index).trimStart();
    }
    chunks.push(rest);
    return chunks;
  };
  const center = (s: string) => wrap(s).map(line => " ".repeat(Math.max(0, Math.floor((width - line.length) / 2))) + line);
  const money = (number: number) => "Rp " + Math.round(number).toLocaleString("id-ID");
  const pair = (label: string, value: string) => {
    const a = clean(label), b = clean(value);
    return a.length + b.length < width ? [a + " ".repeat(width - a.length - b.length) + b] : [...wrap(label), ...wrap(value)];
  };
  const date = new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(receipt.createdAt));
  const lines = [
    ...center(receipt.settings.merchant_name),
    ...(receipt.settings.address ? center(receipt.settings.address) : []),
    "-".repeat(width),
    ...wrap(receipt.orderNumber), ...wrap(date),
    ...(receipt.customerName ? wrap("Nama: " + receipt.customerName) : []),
    ...(receipt.tableLabel ? wrap("Meja: " + receipt.tableLabel) : []),
    "-".repeat(width),
  ];
  for (const item of receipt.lines) {
    lines.push(...wrap(item.quantity + " x " + item.name));
    for (const modifier of item.modifiers) lines.push(...wrap("  + " + modifier));
    if (item.note) lines.push(...wrap("  Catatan: " + item.note));
    lines.push(...pair(money(item.unitPriceIdr) + "/pcs", money(item.lineTotalIdr)));
  }
  lines.push("-".repeat(width), ...pair("Subtotal", money(receipt.subtotalIdr)),
    ...pair("TOTAL", money(receipt.totalIdr)),
    ...wrap("Bayar: " + receipt.paymentLabel + " (" + receipt.paymentStatus + ")"),
    "-".repeat(width), ...center(receipt.settings.footer), "", "", "");
  const encoder = new TextEncoder();
  const text = encoder.encode(lines.join("\n") + "\n");
  const result = new Uint8Array(2 + text.length + 3);
  result.set([0x1b, 0x40], 0);
  result.set(text, 2);
  result.set([0x1d, 0x56, 0x00], 2 + text.length); // cut if supported
  return result;
}
