"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft } from "lucide-react";
import { formatCountdown, formatIDR } from "@/lib/format";
import type { PaymentAttempt } from "./constants";

export function PaymentView({
  payment,
  sessionToken,
  orderType,
  tableLabel,
  onBack,
  onPaid,
  onRetry,
}: {
  payment: PaymentAttempt;
  sessionToken: string;
  orderType: string;
  tableLabel: string;
  onBack: () => void;
  onPaid: () => void;
  onRetry?: () => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [expired, setExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [statusMessage, setStatusMessage] = useState(
    "Menunggu pembayaran terverifikasi",
  );
  const paidRef = useRef(false);

  useEffect(() => {
    QRCode.toDataURL(payment.qrString, { width: 640, margin: 2 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, [payment.qrString]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const expiresAtMs = new Date(payment.expiresAt).getTime();
  const remainingMs = expiresAtMs - now;
  const isExpired = expired || remainingMs <= 0;

  const checkPayment = useCallback(async () => {
    if (paidRef.current) return;
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
      if (payload.paymentStatus === "settled") {
        paidRef.current = true;
        onPaid();
      } else if (payload.paymentStatus === "expired" || payload.paymentStatus === "failed") {
        setExpired(true);
        setStatusMessage("Kode kedaluwarsa. Buat pembayaran baru.");
      } else {
        setStatusMessage(
          "Belum terdeteksi. Kalau sudah bayar, cek lagi.",
        );
      }
    } finally {
      setChecking(false);
    }
  }, [payment.orderId, sessionToken, onPaid]);

  useEffect(() => {
    if (isExpired || paidRef.current) return;
    const timer = window.setInterval(() => {
      void checkPayment();
    }, 7000);
    return () => window.clearInterval(timer);
  }, [checkPayment, isExpired]);

  return (
    <main className="flex min-h-screen justify-center bg-white text-neutral-900 antialiased selection:bg-[#FDBD2C] selection:text-neutral-900">
      <div className="w-full max-w-[440px] px-5 pb-10 pt-[calc(1.25rem+env(safe-area-inset-top))]">
        <button
          onClick={onBack}
          className="mb-8 flex items-center gap-2 text-[13px] text-neutral-500 transition active:scale-95"
        >
          <ArrowLeft size={15} /> Kembali
        </button>
        <div className="ord-rise text-center">
          <p className="text-xs text-neutral-400">
            Order {payment.orderNumber} ·{" "}
            {orderType === "Dine in" ? tableLabel : "Takeaway"}
          </p>
          <p className="mt-3 text-3xl font-medium tabular-nums tracking-tight">
            {formatIDR(payment.amountIdr)}
          </p>
          <p className="mt-1 text-[13px] text-neutral-400">
            {isExpired
              ? "Kode kedaluwarsa"
              : `Berlaku ${formatCountdown(remainingMs)}`}
          </p>
          <div className="shadow-soft mx-auto mt-8 w-fit rounded-3xl border border-neutral-100 bg-white p-4">
            {qrDataUrl && !isExpired ? (
              <img
                src={qrDataUrl}
                alt="QRIS payment code"
                className="h-[220px] w-[220px] rounded-2xl bg-white"
              />
            ) : isExpired ? (
              <div className="flex h-[220px] w-[220px] flex-col items-center justify-center px-6 text-center">
                <p className="text-sm font-medium">Kode kedaluwarsa</p>
                <p className="mt-1 text-[13px] leading-relaxed text-neutral-500">
                  Buat pembayaran baru.
                </p>
              </div>
            ) : (
              <div className="ord-skeleton h-[220px] w-[220px] rounded-2xl" />
            )}
          </div>
          <p className="mt-6 text-[13px] text-neutral-400">
            Scan dengan e-wallet apa pun
          </p>
          <div className="mx-auto mt-8 max-w-[280px] space-y-3">
            {isExpired ? (
              <button
                onClick={onRetry ?? onBack}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                Buat pembayaran baru
              </button>
            ) : (
              <button
                onClick={() => void checkPayment()}
                disabled={checking}
                className="flex h-12 w-full items-center justify-center rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-60"
              >
                {checking ? "Mengecek…" : "Saya sudah bayar"}
              </button>
            )}
            <p className="text-xs text-neutral-400">{statusMessage}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
