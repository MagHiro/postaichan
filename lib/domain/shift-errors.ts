export type ShiftFailure = { code: string; error: string; status: number };

const MESSAGES: Record<string, { error: string; status: number }> = {
  STAFF_NOT_AUTHORIZED: { error: "Sesi kasir tidak memiliki izin.", status: 403 },
  SHIFT_ALREADY_OPEN: { error: "Kasir sudah dibuka. Tutup dulu sebelum membuka lagi.", status: 409 },
  NO_OPEN_SHIFT: { error: "Tidak ada kasir yang sedang buka.", status: 409 },
  INVALID_SHIFT_INTAKE: { error: "Stok awal belum lengkap atau tidak valid.", status: 400 },
  SHIFT_INTAKE_INCOMPLETE: { error: "Stok awal belum lengkap.", status: 400 },
  INVALID_SHIFT_NOTE: { error: "Catatan terlalu panjang (maks 240 karakter).", status: 400 },
  PRODUCT_NOT_FOUND: { error: "Salah satu produk tidak ditemukan.", status: 409 },
};

export function shiftDatabaseFailure(error: unknown): ShiftFailure {
  const raw = error instanceof Error ? error.message : "";
  const match = raw.match(/^([A-Z][A-Z0-9_]*)(?::(.*))?$/);
  const code = match?.[1] ?? "SHIFT_DATABASE_ERROR";
  const detail = match?.[2]?.trim() ?? "";
  if (code === "SHIFT_CLOSE_BLOCKED") {
    const pending = detail || "beberapa";
    return { code, error: `Masih ada ${pending} pembayaran QR yang belum selesai. Tunggu lunas atau kedaluwarsa dulu.`, status: 409 };
  }
  if (code === "SHIFT_INTAKE_INCOMPLETE") {
    return { code, error: detail ? `Produk ini belum diisi stok awalnya: ${detail}.` : MESSAGES[code].error, status: 400 };
  }
  const known = MESSAGES[code];
  if (known) return { code, ...known };
  return { code, error: `Operasi kasir gagal diproses. Coba lagi; jika berulang, laporkan kode ${code}.`, status: 503 };
}
