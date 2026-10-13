"use client";

import { MetaInline } from "@/components/meta";
import { CheckCircle2, QrCode, ScanLine } from "lucide-react";
import { formatCompactIDR, formatIDR } from "@/lib/format";
import type { CartItem } from "@/lib/types";
import { QtyStepper } from "./ui";

export function CartSheet({
  cart,
  onUpdate,
  onCheckout,
  checkoutLoading,
  checkoutError,
  checkoutDisabled = false,
  paymentChoice,
  onPaymentChoiceChange,
  customerName,
  onCustomerNameChange,
  customerNameRequired,
}: {
  cart: CartItem[];
  onUpdate: (key: string, delta: number) => void;
  onCheckout: () => void;
  checkoutLoading: boolean;
  checkoutError: string | null;
  checkoutDisabled?: boolean;
  paymentChoice: "qris" | "qris_manual";
  onPaymentChoiceChange: (choice: "qris" | "qris_manual") => void;
  customerName: string;
  onCustomerNameChange: (name: string) => void;
  customerNameRequired: boolean;
}) {
  const total = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );

  return (
    <div>
      <div className="divide-y divide-[#E9E1D1]">
        {cart.map((item) => (
          <div key={item.key} className="flex items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">
                {item.product.name}
              </p>
              <p className="mt-0.5 truncate text-xs text-[#A8A29E]">
                <MetaInline parts={[[...item.variantLabels, ...item.addonLabels].filter(Boolean).join(", ") || "Original", item.note ? `\u201c${item.note}\u201d` : null]} />
              </p>
              <p className="mt-1 text-[13px] tabular-nums text-[#78716C]">
                {formatCompactIDR(item.unitPrice * item.quantity)}
              </p>
            </div>
            <QtyStepper
              qty={item.quantity}
              onMinus={() => onUpdate(item.key, -1)}
              onPlus={() => onUpdate(item.key, 1)}
              minusLabel={`Kurangi ${item.product.name}`}
              plusLabel={`Tambah ${item.product.name}`}
            />
          </div>
        ))}
      </div>

      <div className="mt-7">
        <label htmlFor="customer-order-name" className="mb-2 block text-[14px] font-semibold">
          Nama pelanggan {customerNameRequired ? <span className="text-[#9E6016]">*</span> : <span className="font-normal text-[#78716C]">(opsional)</span>}
        </label>
        <input
          id="customer-order-name"
          type="text"
          autoComplete="name"
          maxLength={80}
          value={customerName}
          onChange={(event) => onCustomerNameChange(event.target.value)}
          placeholder="Contoh: Rafi"
          required={customerNameRequired}
          aria-required={customerNameRequired}
          className="h-12 w-full rounded-2xl bg-[#F3EEE4] px-4 text-[14px] text-[#1C1917] outline-none transition placeholder:text-[#A8A29E] focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
        />
        <p className="mt-1.5 text-xs text-[#78716C]">
          {customerNameRequired ? "Untuk memudahkan kasir memanggil atau menyerahkan pesanan." : "Nomor meja tetap menjadi acuan; nama membantu saat mengantar pesanan."}
        </p>
      </div>
      <div className="mt-7">
        <h3 className="mb-3 text-[14px] font-semibold">Pilih cara pembayaran</h3>
        <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Metode pembayaran QRIS">
          {([
            { key: "qris_manual", label: "QRIS manual", detail: "Scan QR merchant di kasir; staff verifikasi.", icon: ScanLine },
            { key: "qris", label: "QRIS otomatis", detail: "Scan QR dinamis dari Midtrans.", icon: QrCode },
          ] as const).map((option) => {
            const Icon = option.icon;
            const selected = paymentChoice === option.key;
            return (
              <button key={option.key} type="button" aria-pressed={selected} onClick={() => onPaymentChoiceChange(option.key)}
                className={`relative flex items-start gap-3 rounded-[20px] p-4 text-left ${selected ? "bg-[#FDE8B6]" : "bg-[#F3EEE4] hover:bg-[#EDE5D7]"}`}>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] bg-[#FFFEFB]"><Icon size={19} /></span>
                <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold">{option.label}</span><span className="mt-1 block text-[11px] leading-relaxed text-[#71675C]">{option.detail}</span></span>
                {selected && <CheckCircle2 size={16} className="absolute right-2 top-2 text-[#956716]" />}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-[#78716C]">Total</span>
          <span className="text-[15px] font-medium tabular-nums">
            {formatIDR(total)}
          </span>
        </div>
        <button
          onClick={onCheckout}
          disabled={checkoutLoading || checkoutDisabled || cart.length === 0 || (customerNameRequired && !customerName.trim())}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-[#FDBD2C] text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
        >
          {checkoutLoading ? "Menyiapkan pembayaran…" : "Bayar"}
        </button>
        {checkoutError && (
          <p role="alert" className="mt-2 text-center text-[13px] text-[#78716C]">
            {checkoutError}
          </p>
        )}
        <p className="mt-2 text-center text-xs text-[#A8A29E]">
          {paymentChoice === "qris_manual" ? "Kasir akan memeriksa dan mengonfirmasi pembayaran QRIS onsite." : "Midtrans memverifikasi pembayaran secara otomatis."}
        </p>
      </div>
    </div>
  );
}
