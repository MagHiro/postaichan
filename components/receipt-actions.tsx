"use client";
import { useState } from "react";
import { Bluetooth, Printer } from "lucide-react";
import type { ReceiptData } from "@/lib/receipt-types";
import { printBluetoothReceipt } from "@/lib/receipt-bluetooth";

export function ReceiptActions({ receipt }: { receipt: ReceiptData }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function printBluetooth() {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      await printBluetoothReceipt(receipt);
      setMessage("Data struk telah dikirim ke printer. Pastikan struk tercetak.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tidak dapat terhubung ke printer.");
    } finally { setBusy(false); }
  }
  return (
    <section className="receipt-actions mx-auto mb-6 flex max-w-[420px] flex-col gap-2 px-4 pt-5 print:hidden">
      <p className="mb-1 text-sm text-[#78716C]">Struk pesanan {receipt.orderNumber}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => window.print()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#FDBD2C] px-3 text-sm font-semibold"><Printer size={17} /> Cetak biasa</button>
        <button type="button" disabled={busy} onClick={() => void printBluetooth()}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#1C1917] px-3 text-sm font-semibold text-white disabled:opacity-50"><Bluetooth size={17} /> {busy ? "Mengirim…" : "Bluetooth"}</button>
      </div>
      <p className="text-xs leading-relaxed text-[#78716C]">iPhone/Safari: gunakan Cetak biasa atau AirPrint. Bluetooth langsung memerlukan Chrome Android/desktop dan printer ESC/POS Bluetooth LE yang kompatibel.</p>
      {message && <p role="status" className="rounded-xl bg-[#F3EFE6] px-3 py-2 text-xs leading-relaxed">{message}</p>}
    </section>
  );
}
