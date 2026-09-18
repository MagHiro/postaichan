"use client";

import { Check, Clock3 } from "lucide-react";
import { formatIDR } from "@/lib/format";
import { Container } from "./ui";

export function SuccessView({
  orderType,
  tableLabel,
  amount,
  orderNumber,
  onNewOrder,
}: {
  orderType: string;
  tableLabel: string;
  amount: number;
  orderNumber: string;
  onNewOrder: () => void;
}) {
  return (
    <main className="flex min-h-screen justify-center bg-stone-200 text-[#18181B] antialiased">
      <div className="flex w-full max-w-[440px] items-center justify-center border-x border-stone-200 bg-[#FAF8F5] shadow-2xl">
        <Container className="ord-rise py-10 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-emerald-600 text-white">
            <Check size={40} strokeWidth={2.5} />
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-wider text-emerald-700">
            Pembayaran berhasil
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
            Pesanan diterima.
          </h1>
          <p className="mt-2 text-xs font-normal leading-relaxed text-stone-500">
            {orderType === "Dine in"
              ? `Tetap duduk manis di ${tableLabel}, pesananmu lagi disiapin.`
              : "Pesananmu lagi disiapin. Tunggu panggilan di kasir ya."}
          </p>
          <div className="mt-5 rounded-2xl border border-stone-200/90 bg-white p-4 text-left">
            <div className="flex items-center justify-between border-b border-stone-100 pb-4">
              <span className="text-xs text-stone-500">Nomor pesanan</span>
              <span className="text-sm font-bold">{orderNumber}</span>
            </div>
            <div className="flex items-center justify-between py-4">
              <span className="text-xs text-stone-500">
                {orderType === "Dine in" ? "Meja" : "Tipe pesanan"}
              </span>
              <span className="text-sm font-semibold">
                {orderType === "Dine in" ? tableLabel : "Takeaway"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-stone-100 pt-4">
              <span className="text-xs text-stone-500">Total dibayar</span>
              <span className="text-sm font-extrabold tabular-nums text-[#FF381E]">
                {formatIDR(amount)}
              </span>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-700">
            <Clock3 size={14} /> Dapur sudah terima pesananmu
          </div>
          <button
            onClick={onNewOrder}
            className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-[#FF381E] text-sm font-bold text-white transition hover:bg-[#e03018] active:scale-[0.98]"
          >
            Pesan lagi
          </button>
        </Container>
      </div>
    </main>
  );
}
