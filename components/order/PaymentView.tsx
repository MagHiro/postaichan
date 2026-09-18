"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Clock3 } from "lucide-react";
import { formatIDR } from "@/lib/format";
import type { PaymentAttempt } from "./constants";
import { Container } from "./ui";

export function PaymentView({
  payment,
  sessionToken,
  orderType,
  tableLabel,
  onBack,
  onPaid,
}: {
  payment: PaymentAttempt;
  sessionToken: string;
  orderType: string;
  tableLabel: string;
  onBack: () => void;
  onPaid: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Menunggu pembayaran terverifikasi",
  );

  useEffect(() => {
    QRCode.toDataURL(payment.qrString, { width: 640, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [payment.qrString]);

  async function checkPayment() {
    setChecking(true);
    try {
      const response = await fetch(
        `/api/customer/payments/${payment.orderId}`,
        {
          headers: { "x-order-access-token": sessionToken },
          cache: "no-store",
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        setStatusMessage(
          payload.error ?? "Kami belum bisa mengecek pembayaran.",
        );
        return;
      }
      if (payload.paymentStatus === "settled") onPaid();
      else
        setStatusMessage(
          payload.paymentStatus === "expired"
            ? "QRIS kedaluwarsa. Kembali & buat pembayaran baru."
            : "Belum terdeteksi. Kalau sudah bayar, tap cek lagi.",
        );
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      void checkPayment();
    }, 7000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.orderId, sessionToken]);

  return (
    <main className="flex min-h-screen justify-center bg-stone-200 text-[#18181B] antialiased">
      <div className="w-full max-w-[440px] border-x border-stone-200 bg-[#FAF8F5] pb-10 shadow-2xl">
        <Container className="ord-rise pt-[calc(1.25rem+env(safe-area-inset-top))]">
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-xs font-semibold text-stone-500 transition active:scale-95"
          >
            <ArrowLeft size={15} /> Kembali ke pesanan
          </button>
          <div className="text-center">
            <p className="text-[11px] font-bold uppercase tracking-wider text-stone-400">
              Pembayaran QRIS
            </p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-tight">
              Scan untuk membayar
            </h1>
            <p className="mt-2 text-xs font-normal text-stone-500">
              Order {payment.orderNumber} ·{" "}
              {orderType === "Dine in" ? tableLabel : "Takeaway"}
            </p>
          </div>
          <div className="mt-5 rounded-2xl border border-stone-200/90 bg-white p-4 text-center">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="QRIS payment code"
                className="mx-auto h-[220px] w-[220px] rounded-2xl bg-white"
              />
            ) : (
              <div className="ord-skeleton mx-auto h-[220px] w-[220px] rounded-2xl" />
            )}
            <p className="mt-4 text-xs font-semibold text-stone-500">
              Total yang harus dibayar
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-[#FF381E]">
              {formatIDR(payment.amountIdr)}
            </p>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-stone-400">
              <Clock3 size={13} /> QRIS berlaku 15 menit
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-stone-100 p-2 text-[10px] text-stone-500">
              <span>1. Buka e-wallet</span>
              <span>2. Scan QR</span>
              <span>3. Tap cek status</span>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <button
              onClick={() => void checkPayment()}
              disabled={checking}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#18181B] text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
            >
              {checking ? "Mengecek…" : "Cek status pembayaran"}
            </button>
            <p className="text-center text-xs text-stone-500">
              {statusMessage}
            </p>
          </div>
        </Container>
      </div>
    </main>
  );
}
