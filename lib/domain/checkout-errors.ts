export type CheckoutFailure = {
  code: string;
  error: string;
  status: number;
  retryable?: boolean;
  action?: "retry" | "resume" | "cancel" | "refresh";
};

function withCode(message: string, code: string) {
  return `${message} (kode: ${code})`;
}

function parseDatabaseError(error: unknown) {
  const raw = error instanceof Error ? error.message : "";
  const match = raw.match(/^([A-Z][A-Z0-9_]*)(?::(.*))?$/);
  return { code: match?.[1] ?? "CHECKOUT_DATABASE_ERROR", detail: match?.[2]?.trim() ?? "" };
}

export function invalidCheckoutInput(issue?: { path?: PropertyKey[]; message?: string }): CheckoutFailure {
  const path = issue?.path?.length ? ` pada ${issue.path.join(".")}` : "";
  const detail = issue?.message ? `: ${issue.message}` : ".";
  return { code: "INVALID_CHECKOUT_INPUT", error: withCode(`Data checkout tidak valid${path}${detail}`, "INVALID_CHECKOUT_INPUT"), status: 400, action: "refresh" };
}

export function checkoutDatabaseFailure(error: unknown, audience: "customer" | "staff"): CheckoutFailure {
  const { code, detail } = parseDatabaseError(error);
  if (code === "SESSION_EXPIRED") return { code, error: withCode("Sesi pemesanan sudah berakhir. Muat ulang QR lalu mulai lagi.", code), status: 401, action: "refresh" };
  if (code === "MENU_CONFLICT") return { code, error: withCode("Menu berubah atau item sudah tidak tersedia. Buka menu lagi lalu pilih ulang item tersebut.", code), status: 409, action: "refresh" };
  if (code === "STOCK_CONFLICT") return { code, error: withCode(detail ? `Stok ${detail} berubah. Kurangi jumlah item lalu coba lagi.` : "Stok menu berubah. Kurangi jumlah item lalu coba lagi.", code), status: 409, action: "refresh" };
  if (code === "INVALID_MODIFIERS") return { code, error: withCode("Pilihan varian atau tambahan sudah berubah. Buka item lalu pilih ulang.", code), status: 409, action: "refresh" };
  if (code === "DUPLICATE_MODIFIER") return { code, error: withCode("Pilihan varian atau tambahan terduplikasi. Pilih ulang item tersebut.", code), status: 409, action: "refresh" };
  if (code === "INVALID_QUANTITY") return { code, error: withCode("Jumlah item tidak valid atau melebihi batas. Kurangi jumlah lalu coba lagi.", code), status: 409, action: "refresh" };
  if (code === "MONEY_LIMIT") return { code, error: withCode("Total pesanan melewati batas yang diizinkan.", code), status: 409 };
  if (code === "EMPTY_OR_LARGE_CART") return { code, error: withCode("Keranjang kosong atau terlalu besar untuk diproses.", code), status: 400, action: "refresh" };
  if (code === "INVALID_NOTE") return { code, error: withCode("Catatan pesanan tidak valid. Hapus atau pendekkan catatan lalu coba lagi.", code), status: 409, action: "refresh" };
  if (code === "QRIS_DISABLED") return { code, error: withCode("QRIS sedang dinonaktifkan oleh restoran. Pilih metode pembayaran lain atau hubungi kasir.", code), status: 409 };
  if (code === "CASH_DISABLED") return { code, error: withCode("Pembayaran tunai sedang dinonaktifkan oleh restoran.", code), status: 409 };
  if (code === "CASH_NOT_GUEST") return { code, error: withCode("Pesanan customer tidak dapat menggunakan pembayaran tunai. Pilih QRIS.", code), status: 409 };
  if (code === "ACTIVE_PAYMENT_EXISTS") return { code, error: withCode("Masih ada pembayaran yang belum selesai untuk sesi ini. Lanjutkan QR sebelumnya atau batalkan pesanan pending sebelum membuat pesanan baru.", code), status: 409, action: "resume" };
  if (code === "ORDER_TYPE_CONFLICT") return { code, error: withCode("Jenis pesanan berubah. Mulai checkout baru untuk Dine in atau Takeaway yang dipilih.", code), status: 409, action: "refresh" };
  if (code === "TAKEAWAY_TABLE_CONFLICT") return { code, error: withCode("Pesanan Takeaway tidak dapat memakai meja. Pilih Dine in atau hapus meja.", code), status: 409, action: "refresh" };
  if (code === "TABLE_NOT_AVAILABLE") return { code, error: withCode("Meja sudah tidak aktif atau QR meja sudah berubah. Scan QR meja terbaru.", code), status: 409, action: "refresh" };
  if (code === "QR_NOT_AVAILABLE") return { code, error: withCode("QR pemesanan sudah tidak aktif. Scan QR terbaru.", code), status: 409, action: "refresh" };
  if (code === "IDEMPOTENCY_KEY_REUSED") return { code, error: withCode("Kunci checkout sudah dipakai untuk keranjang berbeda. Mulai checkout baru.", code), status: 409, action: "refresh" };
  if (code === "ORDER_NOT_RETRYABLE") return { code, error: withCode("Pesanan ini sudah dibatalkan atau selesai dan tidak dapat dicoba ulang. Buat pesanan baru.", code), status: 409, action: "refresh" };
  if (code === "INVALID_IDEMPOTENCY") return { code, error: withCode("Identitas checkout tidak valid. Muat ulang halaman lalu coba lagi.", code), status: 400, action: "refresh" };
  if (code === "STAFF_NOT_AUTHORIZED") return { code, error: withCode("Sesi kasir tidak memiliki izin membuat pesanan.", code), status: 403 };
  if (code === "SHIFT_CLOSED") {
    const message = audience === "staff" ? "Kasir sedang tutup. Buka kasir dan isi stok awal dulu." : "Kasir sedang tutup. Coba lagi nanti atau hubungi kasir.";
    return { code, error: withCode(message, code), status: 409, action: "refresh" };
  }
  if (code === "CATEGORY_NOT_AVAILABLE" || code === "INVALID_PRODUCT" || code === "PRODUCT_NOT_FOUND") return { code, error: withCode("Item menu tidak valid atau sudah tidak tersedia. Muat ulang menu.", code), status: 409, action: "refresh" };

  const prefix = audience === "staff" ? "Pesanan kasir" : "Checkout";
  return { code, error: withCode(`${prefix} gagal diproses karena database menolak permintaan. Coba lagi; jika berulang, laporkan kode ini.`, code), status: 503, retryable: true };
}

export function checkoutIntentMissing(): CheckoutFailure {
  return { code: "CHECKOUT_INTENT_MISSING", error: withCode("Database tidak mengembalikan pembayaran untuk pesanan ini. Tidak ada pembayaran yang dibuat; coba lagi.", "CHECKOUT_INTENT_MISSING"), status: 503, retryable: true };
}

export function checkoutQrMissing(orderId?: string): CheckoutFailure & { orderId?: string } {
  return { code: "PAYMENT_QR_MISSING", error: withCode("Midtrans membuat transaksi tetapi tidak mengembalikan QR. Pesanan belum bisa dibayar; coba tombol yang sama lagi.", "PAYMENT_QR_MISSING"), status: 503, retryable: true, ...(orderId ? { orderId } : {}) };
}

export function checkoutUnexpectedFailure(audience: "customer" | "staff"): CheckoutFailure {
  const code = audience === "staff" ? "CASHIER_CHECKOUT_INTERNAL_ERROR" : "CHECKOUT_INTERNAL_ERROR";
  return { code, error: withCode(audience === "staff" ? "Pesanan kasir gagal karena server tidak dapat menyelesaikan checkout. Tidak diketahui apakah pembayaran dibuat; cek daftar pesanan sebelum mencoba lagi." : "Checkout gagal karena server tidak dapat menyelesaikan pembayaran. Tidak diketahui apakah pembayaran dibuat; cek status pesanan sebelum mencoba lagi.", code), status: 503, retryable: true };
}
