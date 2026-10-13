"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, QrCode, ShieldCheck, X } from "lucide-react";
import { formatIDR } from "@/lib/format";

export type ManualQrisIntent = {
  orderId: string; orderNumber: string; totalIdr: number; expiresAt?: string;
};

export function ManualQrisVerification({
  payment, onClose, onVerified,
}: {
  payment: ManualQrisIntent;
  onClose: () => void;
  onVerified: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expired = payment.expiresAt ? new Date(payment.expiresAt).getTime() <= Date.now() : false;

  async function verify() {
    if (busy || !confirmed || expired) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/pos/orders/${payment.orderId}/manual-payment`, { method: "POST", cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.paymentStatus !== "settled") {
        setError(payload?.error ?? "Verifikasi tidak berhasil. Periksa status pembayaran.");
        return;
      }
      onVerified();
    } catch {
      setError("Koneksi terputus. Verifikasi belum dikonfirmasi; cek daftar pesanan sebelum mencoba lagi.");
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-[100] flex items-end justify-center bg-[#1C1917]/40 p-0 sm:items-center sm:p-5" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="manual-qris-title" onClick={(event) => event.stopPropagation()}
        className="ord-sheet w-full max-w-[460px] rounded-t-[32px] bg-[#FFFEFB] p-6 shadow-soft sm:rounded-[32px] sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <span className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-[#FDE7AD]"><QrCode size={25} strokeWidth={1.8} /></span>
          <button type="button" onClick={onClose} aria-label="Tutup" className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F2ECE1]"><X size={18} /></button>
        </div>
        <h2 id="manual-qris-title" className="mt-6 text-[26px] font-semibold leading-tight tracking-[-.05em]">QRIS manual</h2>
        <p className="mt-2 text-[13px] leading-[1.8] text-[#71675C]">Pelanggan melakukan scan QRIS merchant yang tersedia di lokasi. Transaksi ini tidak melalui Midtrans.</p>
        <div className="mt-6 rounded-[23px] bg-[#F5EEE3] p-5">
          <p className="text-[12px] text-[#897B69]">{payment.orderNumber}</p>
          <p className="mt-2 text-[31px] font-semibold tabular-nums tracking-[-.05em]">{formatIDR(payment.totalIdr)}</p>
          <div className="mt-4 flex items-start gap-3 text-[13px] leading-relaxed text-[#71675C]">
            <QrCode size={19} className="mt-0.5 shrink-0 text-[#B07A16]" />
            Arahkan pelanggan untuk scan QRIS fisik di kasir, lalu periksa mutasi atau notifikasi merchant.
          </div>
        </div>
        {expired && <p role="alert" className="mt-4 rounded-2xl bg-[#FBE6D9] p-3 text-[13px] text-[#994D2B]">Masa pembayaran berakhir. Batalkan pesanan ini dan buat pesanan baru.</p>}
        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-[18px] bg-[#F9F5ED] p-4">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}
            disabled={expired} className="mt-1 h-[18px] w-[18px] shrink-0 accent-[#DCA014]" />
          <span className="text-[13px] leading-relaxed"><strong className="font-semibold">Saya sudah memeriksa pembayaran.</strong><br /><span className="text-[#71675C]">Dana sebesar {formatIDR(payment.totalIdr)} benar-benar diterima pada akun merchant.</span></span>
        </label>
        {error && <p role="alert" className="mt-3 text-[12px] leading-relaxed text-[#A4442E]">{error}</p>}
        <button type="button" onClick={() => void verify()} disabled={!confirmed || busy || expired}
          className="modern-action mt-5 w-full disabled:cursor-not-allowed disabled:opacity-40">
          <ShieldCheck size={18} /> {busy ? "Memverifikasi…" : "Verifikasi pembayaran diterima"}
        </button>
        <button type="button" onClick={onClose} className="mt-3 h-11 w-full text-[13px] font-medium text-[#78716C]">Nanti saja</button>
        <p className="mt-2 flex items-center justify-center gap-2 text-center text-[11px] text-[#978B7D]"><CheckCircle2 size={14} /> Verifikasi dicatat bersama akun staff untuk audit.</p>
      </section>
    </div>, document.body,
  );
}
