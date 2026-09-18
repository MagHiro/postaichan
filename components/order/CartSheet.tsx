"use client";

import { ArrowRight, Plus, QrCode, X } from "lucide-react";
import { formatCompactIDR, formatIDR } from "@/lib/format";
import type { CartItem, Product } from "@/lib/types";
import { Container, ProductImage, QtyStepper } from "./ui";

export function CartSheet({
  cart,
  orderType,
  tableLabel,
  menuProducts,
  onClose,
  onUpdate,
  onQuickAdd,
  onCheckout,
  checkoutLoading,
  checkoutError,
}: {
  cart: CartItem[];
  orderType: "Dine in" | "Takeaway";
  tableLabel: string;
  menuProducts: Product[];
  onClose: () => void;
  onUpdate: (key: string, delta: number) => void;
  onQuickAdd: (p: Product) => void;
  onCheckout: () => void;
  checkoutLoading: boolean;
  checkoutError: string | null;
}) {
  const total = cart.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0,
  );
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  const hasSate = cart.some((i) =>
    /sate|kulit|rice bowl/i.test(i.product.name),
  );
  const hasDrink = cart.some((i) => i.product.category === "Drinks");
  const suggestion =
    !hasDrink && hasSate
      ? (menuProducts.find((p) => p.category === "Drinks" && p.available) ??
        null)
      : null;

  return (
    <div
      className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#18181B]/45"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ord-sheet flex max-h-[92vh] w-full max-w-[440px] flex-col rounded-t-3xl bg-[#FAF8F5]"
      >
        <Container className="flex items-center justify-between pb-3 pt-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-[#18181B]">
              Pesanan kamu
            </h2>
            <p className="mt-0.5 text-xs font-normal text-stone-500">
              {orderType === "Dine in" ? `Makan di Tempat · ${tableLabel}` : "Takeaway · Ambil di kasir"}
            </p>
          </div>
          <button
            aria-label="Tutup keranjang"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-200 bg-white text-[#18181B] shadow-xs transition active:scale-90"
          >
            <X size={17} />
          </button>
        </Container>

        <Container className="mt-1 flex-1 space-y-3 overflow-y-auto pb-2">
          {cart.length === 0 && (
            <p className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center text-xs text-stone-500">
              Keranjang masih kosong. Yuk pilih menu dulu.
            </p>
          )}
          {cart.map((item) => (
            <div
              key={item.key}
              className="flex gap-3 rounded-2xl border border-stone-200/80 bg-white p-3"
            >
              <ProductImage
                product={item.product}
                className="h-14 w-14 shrink-0 rounded-xl"
                iconSize={22}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold leading-snug text-[#18181B]">
                  {item.product.name}
                </p>
                <p className="mt-1 truncate text-[11px] font-normal text-stone-500">
                  {[item.variant, ...item.addons].filter(Boolean).join(" · ") ||
                    "Original"}
                  {item.note ? ` · "${item.note}"` : ""}
                </p>
                <p className="mt-1 text-xs font-black tabular-nums text-[#18181B]">
                  {formatCompactIDR(item.unitPrice * item.quantity)}
                </p>
              </div>
              <div className="self-center">
                <QtyStepper
                  qty={item.quantity}
                  onMinus={() => onUpdate(item.key, -1)}
                  onPlus={() => onUpdate(item.key, 1)}
                  minusLabel="Kurangi"
                  plusLabel="Tambah"
                />
              </div>
            </div>
          ))}

          {suggestion && (
            <button
              onClick={() => onQuickAdd(suggestion)}
              className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-red-200 bg-red-50/50 p-3 text-left transition active:scale-[0.98]"
            >
              <ProductImage
                product={suggestion}
                className="h-11 w-11 shrink-0 rounded-xl"
                iconSize={20}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-[#FF381E]">
                  Sering dibeli bareng
                </span>
                <span className="block truncate text-xs font-bold leading-snug text-[#18181B]">
                  {suggestion.name} · {formatCompactIDR(suggestion.price)}
                </span>
              </span>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FF381E] text-white">
                <Plus size={14} />
              </span>
            </button>
          )}
        </Container>

        <div className="border-t border-stone-200/80 bg-[#FAF8F5] pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Container className="pt-4">
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-stone-500">
              <span>Subtotal ({count} item)</span>
              <span className="font-bold tabular-nums text-[#18181B]">
                {formatCompactIDR(total)}
              </span>
            </div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-black uppercase tracking-wider text-[#18181B]">
                Total bayar
              </span>
              <span className="text-sm font-extrabold tabular-nums tracking-tight text-[#18181B]">
                {formatIDR(total)}
              </span>
            </div>
            <button
              onClick={onCheckout}
              disabled={checkoutLoading || cart.length === 0}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF381E] text-sm font-bold text-white shadow-md transition hover:bg-[#e03018] active:scale-[0.98] disabled:opacity-50"
            >
              {checkoutLoading ? (
                "Menyiapkan QRIS…"
              ) : (
                <>
                  Lanjut ke pembayaran <ArrowRight size={15} />
                </>
              )}
            </button>
            {checkoutError && (
              <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-center text-[11px] font-semibold text-red-700">
                {checkoutError}
              </p>
            )}
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[10px] text-stone-400">
              <QrCode size={12} /> Bayar via QRIS · pesanan masuk dapur setelah
              bayar
            </p>
          </Container>
        </div>
      </div>
    </div>
  );
}
