"use client";

import { formatCompactIDR, formatIDR } from "@/lib/format";
import type { CartItem } from "@/lib/types";
import { QtyStepper } from "./ui";

export function CartSheet({
  cart,
  onUpdate,
  onCheckout,
  checkoutLoading,
  checkoutError,
}: {
  cart: CartItem[];
  onUpdate: (key: string, delta: number) => void;
  onCheckout: () => void;
  checkoutLoading: boolean;
  checkoutError: string | null;
}) {
  const total = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );

  return (
    <div>
      <div className="divide-y divide-neutral-100">
        {cart.map((item) => (
          <div key={item.key} className="flex items-center gap-3 py-3.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">
                {item.product.name}
              </p>
              <p className="mt-0.5 truncate text-xs text-neutral-400">
                {[...item.variantLabels, ...item.addonLabels].filter(Boolean).join(" · ") ||
                  "Original"}
                {item.note ? ` · “${item.note}”` : ""}
              </p>
              <p className="mt-1 text-[13px] tabular-nums text-neutral-500">
                {formatCompactIDR(item.unitPrice * item.quantity)}
              </p>
            </div>
            <QtyStepper
              qty={item.quantity}
              onMinus={() => onUpdate(item.key, -1)}
              onPlus={() => onUpdate(item.key, 1)}
              minusLabel="Kurangi"
              plusLabel="Tambah"
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] text-neutral-500">Total</span>
          <span className="text-[15px] font-medium tabular-nums">
            {formatIDR(total)}
          </span>
        </div>
        <button
          onClick={onCheckout}
          disabled={checkoutLoading || cart.length === 0}
          className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
        >
          {checkoutLoading ? "Menyiapkan pembayaran…" : "Bayar"}
        </button>
        {checkoutError && (
          <p className="mt-2 text-center text-[13px] text-neutral-500">
            {checkoutError}
          </p>
        )}
        <p className="mt-2 text-center text-xs text-neutral-400">
          Bayar via QRIS
        </p>
      </div>
    </div>
  );
}
