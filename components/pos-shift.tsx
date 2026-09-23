"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minus, Plus, X } from "lucide-react";
import { formatCompactIDR, formatIDR } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDialogFocus } from "@/components/use-dialog-focus";

export type ShiftStatus = {
  open: boolean;
  shift: { id: string; opened_at: string; opened_by: string | null; opening_note: string | null } | null;
};

type IntakeProduct = { id: string; name: string; stock_quantity: number };

export type CloseRecap = {
  shiftId: string;
  openedAt: string;
  pendingCount: number;
  grossRevenueIdr: number;
  refundsIdr: number;
  netRevenueIdr: number;
  orderCount: number;
  cashRevenueIdr: number;
  qrisRevenueIdr: number;
  itemsSold: number;
  products: Array<{ product_id: string | null; name: string; quantity: number; revenueIdr: number }>;
  remaining: Array<{ productId: string; name: string; openingQuantity: number; soldQuantity: number; remainingQuantity: number }>;
};

export function useShiftStatus(onShowNotice: (message: string) => void) {
  const [shift, setShift] = useState<ShiftStatus | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/pos/shifts/status", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (response.ok && payload) setShift({ open: payload.open === true, shift: payload.shift ?? null });
      else if (!silent) onShowNotice("Status kasir belum dapat dimuat.");
    } catch {
      if (!silent) onShowNotice("Koneksi terputus. Status kasir belum dapat dimuat.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Fetch status on mount only; callers refresh after open/close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { shift, loading, refresh };
}

/* ================= Open sheet ================= */

export function ShiftOpenSheet({ onClose, onOpened }: { onClose: () => void; onOpened: () => void }) {
  const [products, setProducts] = useState<IntakeProduct[] | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pos/shifts/intake-products", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Daftar stok belum dapat dimuat.");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        const list = (payload.products ?? []) as IntakeProduct[];
        setProducts(list);
        setCounts(Object.fromEntries(list.map((product) => [product.id, String(product.stock_quantity ?? 0)])));
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Daftar stok belum dapat dimuat.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function setCount(id: string, delta: number) {
    setCounts((current) => {
      const next = Math.max(0, Math.min(1000000, Number(current[id] ?? 0) + delta));
      return { ...current, [id]: String(next) };
    });
  }

  const filled = products !== null && products.every((product) => counts[product.id] !== undefined && counts[product.id] !== "");

  async function submit() {
    if (!products || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/shifts/open", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined, items: products.map((product) => ({ productId: product.id, quantity: Number(counts[product.id] ?? 0) })) }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kasir belum berhasil dibuka.");
      onOpened();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Kasir belum berhasil dibuka.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 p-0 sm:items-center sm:p-5" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet flex max-h-[92dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[28px] bg-white text-neutral-900 sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-open-title"
      >
        <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-neutral-200" />
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-3">
          <div className="min-w-0">
            <p className="text-xs text-neutral-400">Kasir tutup</p>
            <h2 id="shift-open-title" className="mt-1 text-lg font-medium tracking-tight">Buka kasir</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">Isi stok awal semua produk terpantau. Stok selalu diisi saat buka.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {error && <p role="alert" className="mb-4 text-center text-[13px] text-neutral-500">{error}</p>}
          {products === null ? (
            <div className="divide-y divide-neutral-100" aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-3 py-3.5">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ord-skeleton h-3.5 w-2/3 rounded-full" />
                    <div className="ord-skeleton h-3 w-1/2 rounded-full" />
                  </div>
                  <div className="ord-skeleton h-9 w-28 shrink-0 rounded-full" />
                </div>
              ))}
            </div>
          ) : products.length ? (
            <div className="divide-y divide-neutral-100">
              {products.map((product) => (
                <div key={product.id} className="flex items-center gap-3 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-neutral-900">{product.name}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-neutral-400">Terakhir {product.stock_quantity} tersisa</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button type="button" onClick={() => setCount(product.id, -1)} aria-label={`Kurangi ${product.name}`} className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 active:scale-95">
                      <Minus size={14} />
                    </button>
                    <input
                      value={counts[product.id] ?? ""}
                      onChange={(event) => {
                        const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 7);
                        setCounts((current) => ({ ...current, [product.id]: digits }));
                      }}
                      inputMode="numeric"
                      aria-label={`Stok awal ${product.name}`}
                      className="h-9 w-14 rounded-2xl bg-neutral-100 text-center text-sm font-medium tabular-nums outline-none focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
                    />
                    <button type="button" onClick={() => setCount(product.id, 1)} aria-label={`Tambah ${product.name}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white active:scale-95">
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-10 text-center text-[13px] text-neutral-500">Tidak ada produk terpantau. Kasir bisa langsung dibuka.</p>
          )}
          <label className="mt-4 block">
            <span className="mb-2 block text-[13px] font-medium">Catatan <span className="font-normal text-neutral-400">· opsional</span></span>
            <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Shift pagi" maxLength={240} className="input" />
          </label>
        </div>
        <div className="shrink-0 border-t border-neutral-100 bg-[#FAFAFA]/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!filled || saving}
            className="h-12 w-full rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
          >
            {saving ? "Membuka…" : "Buka kasir"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/* ================= Close sheet ================= */

export function ShiftCloseSheet({ onClose, onClosed, onShowNotice }: { onClose: () => void; onClosed: () => void; onShowNotice: (message: string) => void }) {
  const [recap, setRecap] = useState<CloseRecap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pos/shifts/recap", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw new Error(payload?.error ?? "Rekap kasir belum dapat dimuat.");
        return payload;
      })
      .then((payload) => {
        if (!cancelled) setRecap(payload.recap as CloseRecap);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Rekap kasir belum dapat dimuat.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit() {
    if (closing) return;
    setClosing(true);
    setError(null);
    try {
      const response = await fetch("/api/pos/shifts/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error ?? "Kasir belum berhasil ditutup.");
      onClosed();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Kasir belum berhasil ditutup.";
      setError(message);
      onShowNotice(message);
    } finally {
      setClosing(false);
    }
  }

  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30 p-0 sm:items-center sm:p-5" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet flex max-h-[92dvh] w-full max-w-[440px] flex-col overflow-hidden rounded-t-[28px] bg-white text-neutral-900 sm:rounded-[28px] lg:max-w-[560px]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shift-close-title"
      >
        <div className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-neutral-200" />
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pb-4 pt-3">
          <div className="min-w-0">
            <p className="text-xs text-neutral-400">Tutup kasir</p>
            <h2 id="shift-close-title" className="mt-1 text-lg font-medium tracking-tight">Rekap shift</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 active:scale-95">
            <X size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {error && <p role="alert" className="mb-4 text-center text-[13px] text-neutral-500">{error}</p>}
          {!recap ? (
            <div className="grid grid-cols-2 gap-3" aria-hidden="true">
              {[0, 1, 2, 3].map((row) => (
                <div key={row} className="min-h-[108px] rounded-2xl border border-neutral-100 bg-white p-4">
                  <div className="ord-skeleton h-3 w-2/3 rounded-full" />
                  <div className="ord-skeleton mt-2 h-6 w-1/2 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {recap.pendingCount > 0 && (
                <p className="mb-4 rounded-2xl bg-neutral-100 p-4 text-[13px] leading-relaxed text-neutral-500">
                  {recap.pendingCount} pembayaran QR masih menunggu. Tunggu lunas atau kedaluwarsa sebelum tutup.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="min-h-[108px] rounded-2xl border border-neutral-100 bg-white p-4">
                  <p className="truncate text-xs text-neutral-400">Penjualan bersih</p>
                  <p className="mt-1 text-[22px] font-medium tabular-nums tracking-tight">{formatCompactIDR(recap.netRevenueIdr)}</p>
                  <p className="mt-0.5 truncate text-[13px] text-neutral-500">{recap.orderCount} lunas</p>
                </div>
                <div className="min-h-[108px] rounded-2xl border border-neutral-100 bg-white p-4">
                  <p className="truncate text-xs text-neutral-400">Item terjual</p>
                  <p className="mt-1 text-[22px] font-medium tabular-nums tracking-tight">{recap.itemsSold}</p>
                  <p className="mt-0.5 truncate text-[13px] text-neutral-500">Tunai {formatCompactIDR(recap.cashRevenueIdr)}</p>
                </div>
                <div className="min-h-[108px] rounded-2xl border border-neutral-100 bg-white p-4">
                  <p className="truncate text-xs text-neutral-400">QRIS</p>
                  <p className="mt-1 text-[22px] font-medium tabular-nums tracking-tight">{formatCompactIDR(recap.qrisRevenueIdr)}</p>
                  <p className="mt-0.5 truncate text-[13px] text-neutral-500">Kotor {formatCompactIDR(recap.grossRevenueIdr)}</p>
                </div>
                <div className="min-h-[108px] rounded-2xl border border-neutral-100 bg-white p-4">
                  <p className="truncate text-xs text-neutral-400">Refund</p>
                  <p className="mt-1 text-[22px] font-medium tabular-nums tracking-tight">{formatCompactIDR(recap.refundsIdr)}</p>
                  <p className="mt-0.5 truncate text-[13px] text-neutral-500">Diproses shift ini</p>
                </div>
              </div>
              <h3 className="mb-1 mt-8 text-sm font-medium text-neutral-900">Terjual shift ini</h3>
              {recap.products.length ? (
                <div className="divide-y divide-neutral-100">
                  {recap.products.map((item) => (
                    <div key={`${item.product_id ?? item.name}`} className="flex items-center justify-between gap-3 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-neutral-900">{item.name}</p>
                        <p className="mt-0.5 text-xs tabular-nums text-neutral-400">{item.quantity} porsi</p>
                      </div>
                      <span className="shrink-0 text-[13px] tabular-nums text-neutral-500">{formatCompactIDR(item.revenueIdr)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-6 text-center text-[13px] text-neutral-500">Belum ada penjualan lunas.</p>
              )}
              {recap.remaining.length > 0 && (
                <>
                  <h3 className="mb-1 mt-8 text-sm font-medium text-neutral-900">Sisa stok</h3>
                  <div className="divide-y divide-neutral-100">
                    {recap.remaining.map((row) => (
                      <div key={row.productId} className="flex items-center justify-between gap-3 py-3.5">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-neutral-900">{row.name}</p>
                          <p className="mt-0.5 text-xs tabular-nums text-neutral-400">Awal {row.openingQuantity} · terjual {row.soldQuantity}</p>
                        </div>
                        <span className={cn("shrink-0 text-[13px] tabular-nums", row.remainingQuantity <= 0 ? "text-neutral-900" : "text-neutral-500")}>
                          {row.remainingQuantity} tersisa
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <label className="mt-6 block">
                <span className="mb-2 block text-[13px] font-medium">Catatan <span className="font-normal text-neutral-400">· opsional</span></span>
                <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Hasil cocok dengan laci" maxLength={240} className="input" />
              </label>
              <p className="mt-4 text-xs leading-relaxed text-neutral-400">Menutup kasir mengarsipkan rekap ini. QR yang sudah dibuat sebelum tutup tetap bisa lunas.</p>
            </>
          )}
        </div>
        <div className="shrink-0 border-t border-neutral-100 bg-[#FAFAFA]/95 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!recap || closing}
            className="h-12 w-full rounded-full bg-neutral-900 text-sm font-medium text-white active:scale-[0.98] disabled:opacity-40"
          >
            {closing ? "Menutup…" : "Tutup kasir"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function formatShiftOpenedAt(iso: string) {
  const date = new Date(iso);
  return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" }).format(date);
}
