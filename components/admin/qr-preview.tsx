"use client";

import { Copy, Download, Printer, X } from "lucide-react";

export function QrPreview({ label, orderingUrl, qrDataUrl, onClose, onCopy }: { label: string; orderingUrl: string; qrDataUrl: string; onClose?: () => void; onCopy: () => void }) {
  function download() {
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ordering-qr"}.png`;
    link.click();
  }

  function print() {
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!printWindow) return;
    printWindow.document.title = `QR ${label}`;
    const heading = printWindow.document.createElement("h1");
    heading.textContent = label;
    const image = printWindow.document.createElement("img");
    image.src = qrDataUrl;
    image.alt = `QR pemesanan ${label}`;
    image.style.width = "320px";
    image.style.height = "320px";
    const url = printWindow.document.createElement("p");
    url.textContent = orderingUrl;
    url.style.maxWidth = "320px";
    url.style.wordBreak = "break-all";
    printWindow.document.body.style.fontFamily = "Arial, sans-serif";
    printWindow.document.body.style.textAlign = "center";
    printWindow.document.body.append(heading, image, url);
    image.onload = () => { printWindow.focus(); printWindow.print(); };
  }

  return (
    <section className="mt-6 rounded-2xl border border-neutral-100 bg-white p-5 shadow-soft">
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-[13px] font-medium">QR baru siap</p><p className="mt-1 text-xs text-neutral-500">{label}</p></div>
        {onClose && <button type="button" onClick={onClose} aria-label="Tutup pratinjau QR" className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 text-neutral-500"><X size={14} /></button>}
      </div>
      <div className="mt-5 flex flex-col items-center gap-4 rounded-2xl bg-[#FAFAFA] p-4"><img src={qrDataUrl} alt={`QR pemesanan ${label}`} className="h-56 w-56 rounded-xl" /><p className="max-w-full break-all text-center text-xs text-neutral-500">{orderingUrl}</p></div>
      <p className="mt-4 text-xs leading-relaxed text-neutral-500">Simpan atau cetak sekarang. Token lama tidak dapat dibuat ulang; rotasi QR akan langsung membatalkan QR sebelumnya.</p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button type="button" onClick={onCopy} className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#FDBD2C] px-3 text-[13px] font-medium"><Copy size={14} /> Salin</button>
        <button type="button" onClick={download} className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-neutral-200 px-3 text-[13px] font-medium"><Download size={14} /> Unduh</button>
        <button type="button" onClick={print} className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-neutral-200 px-3 text-[13px] font-medium"><Printer size={14} /> Cetak</button>
      </div>
    </section>
  );
}
