"use client";

import { formatIDR } from "@/lib/format";

export function SuccessView({
  tableLabel,
  amount,
  orderNumber,
  onHome,
  onViewOrders,
}: {
  tableLabel: string | null;
  amount: number;
  orderNumber: string;
  onHome: () => void;
  onViewOrders: () => void;
}) {
  return (
    <main className="flex min-h-screen justify-center bg-[#FAF7F1] text-[#1C1917] antialiased selection:bg-[#FDBD2C] selection:text-[#1C1917]">
      <div className="flex w-full max-w-[440px] flex-col justify-center px-5 py-10">
        <div className="ord-rise text-center">
          <p className="text-[13px] text-[#A8A29E]">Pembayaran berhasil</p>
          <h1 className="mt-2 text-[22px] font-medium leading-snug tracking-tight">
            Pesanan diterima
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-[#78716C]">
            {tableLabel
              ? `Tetap di ${tableLabel}, pesananmu sedang disiapkan.`
              : "Pesananmu sedang disiapkan. Tunggu panggilan di kasir."}
          </p>
          <div className="mx-auto mt-8 max-w-[320px] divide-y divide-[#E9E1D1] border-y border-[#EFE7D6] text-left">
            <div className="flex items-center justify-between py-3.5">
              <span className="text-[13px] text-[#A8A29E]">
                Nomor pesanan
              </span>
              <span className="text-[13px] font-medium">{orderNumber}</span>
            </div>
            <div className="flex items-center justify-between py-3.5">
              <span className="text-[13px] text-[#A8A29E]">Total</span>
              <span className="text-[13px] font-medium tabular-nums">
                {formatIDR(amount)}
              </span>
            </div>
          </div>
          <div className="mx-auto mt-8 max-w-[320px] space-y-2.5">
            <button
              onClick={onViewOrders}
              className="flex h-12 w-full items-center justify-center rounded-full bg-[#FDBD2C] text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98]"
            >
              Lihat pesanan
            </button>
            <button
              onClick={onHome}
              className="flex h-12 w-full items-center justify-center rounded-full text-sm text-[#78716C] transition active:scale-[0.98]"
            >
              Kembali ke beranda
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
