"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { ArrowLeft, Clock3, RotateCcw } from "lucide-react";
import { formatCountdown, formatIDR } from "@/lib/format";
import type { PaymentAttempt } from "./constants";
import { Container } from "./ui";

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
        setStatusMessage("QRIS kedaluwarsa. Buat pembayaran baru untuk lanjut.");
      } else {
        setStatusMessage(
          "Belum terdeteksi. Kalau sudah bayar, tap cek lagi.",
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
    <main className="flex min-h-screen justify-center bg-stone-200 text-[#18181B] antialiased">
      <div className="w-full max-w-[440px] border-x border-stone-200 bg-[#FAF8F5] pb-10 shadow-2xl">
        <Container className="ord-rise pt-[calc(1.25rem+env(safe-area-inset-top))]">
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 text-[13px] font-semibold text-stone-600 transition active:scale-95"
          >
            <ArrowLeft size={15} /> Kembali ke pesanan
          </button>
          <div className="text-center">
            <p className="text-[13px] font-bold uppercase tracking-wider text-stone-600">
              Pembayaran QRIS
            </p>
            <h1 className="mt-2 text-2xl font-extrabold tracking-normal">
              Scan untuk membayar
            </h1>
            <p className="mt-2 text-[13px] font-semibold text-stone-600">
              Order {payment.orderNumber} ·{" "}
              {orderType === "Dine in" ? tableLabel : "Takeaway"}
            </p>
          </div>
          <div className="mt-5 rounded-2xl border border-stone-200/90 bg-white p-4 text-center">
            {qrDataUrl && !isExpired ? (
              <img
                src={qrDataUrl}
                alt="QRIS payment code"
                className="mx-auto h-[220px] w-[220px] rounded-2xl bg-white"
              />
            ) : isExpired ? (
              <div className="mx-auto flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 rounded-2xl bg-stone-100 px-6 text-center">
                <Clock3 size={28} className="text-stone-600" />
                <p className="text-[13px] font-bold text-stone-600">QRIS kedaluwarsa</p>
                <p className="text-[13px] font-semibold leading-relaxed text-stone-600">
                  Kode 15 menit habis. Buat pembayaran baru — jangan bayar ke kode lama.
                </p>
              </div>
            ) : (
              <div className="ord-skeleton mx-auto h-[220px] w-[220px] rounded-2xl" />
            )}
            <p className="mt-4 text-[13px] font-semibold text-stone-600">
              Total yang harus dibayar
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-normal text-[#FF381E]">
              {formatIDR(payment.amountIdr)}
            </p>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[13px] font-semibold text-stone-600">
              <Clock3 size={13} />
              {isExpired ? (
                <span className="font-bold text-stone-600">QRIS kedaluwarsa</span>
              ) : (
                <span>
                  Berlaku <span className="font-bold tabular-nums text-stone-600">{formatCountdown(remainingMs)}</span>
                </span>
              )}
            </div>
            {!isExpired && (
              <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-stone-100 p-2 text-[13px] font-semibold text-stone-600">
                <span>1. Buka e-wallet</span>
                <span>2. Scan QR</span>
                <span>3. Tap cek status</span>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-3">
            {isExpired ? (
              <button
                onClick={onRetry ?? onBack}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF381E] text-sm font-bold text-white transition hover:bg-[#e03018] active:scale-[0.98]"
              >
                <RotateCcw size={16} /> Buat pembayaran baru
              </button>
            ) : (
              <button
                onClick={() => void checkPayment()}
                disabled={checking}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#18181B] text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                {checking ? "Mengecek…" : "Cek status pembayaran"}
              </button>
            )}
            <p className="text-center text-[13px] font-semibold text-stone-600">
              {statusMessage}
            </p>
          </div>
        </Container>
      </div>
    </main>
  );
}
