"use client";

import { Minus, Plus, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ADDON_OPTIONS, RICE_OPTIONS, SPICE_LEVELS } from "./constants";
import { ProductImage } from "./ui";

export function ProductSheet({
  product,
  quantity,
  setQuantity,
  variant,
  setVariant,
  rice,
  setRice,
  addons,
  setAddons,
  note,
  setNote,
  onClose,
  onAdd,
}: {
  product: Product;
  quantity: number;
  setQuantity: (v: number) => void;
  variant: string;
  setVariant: (v: string) => void;
  rice: string;
  setRice: (v: string) => void;
  addons: string[];
  setAddons: (v: string[]) => void;
  note: string;
  setNote: (v: string) => void;
  onClose: () => void;
  onAdd: () => void;
}) {
  const hasSpice = product.options === "spice";
  const hasRice = product.options === "rice";
  const total =
    (product.price + addons.length * 5000 + (rice === "Lontong" ? 2000 : 0)) *
    quantity;
  const toggleAddon = (addon: string) =>
    setAddons(
      addons.includes(addon)
        ? addons.filter((a) => a !== addon)
        : [...addons, addon],
    );

  return (
    <div
      className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ord-sheet max-h-[92vh] w-full max-w-[440px] overflow-y-auto rounded-t-[28px] bg-white"
      >
        <div className="px-5 pb-4 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-neutral-200" />
          <div className="relative">
            <ProductImage
              product={product}
              eager
              className="aspect-[16/10] w-full rounded-2xl"
            />
            <button
              aria-label="Tutup"
              onClick={onClose}
              className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-500 backdrop-blur transition active:scale-95"
            >
              <X size={15} />
            </button>
          </div>
          <div className="mt-4">
            <h2 className="text-lg font-medium tracking-tight">
              {product.name}
            </h2>
            <p className="mt-0.5 text-sm tabular-nums text-neutral-500">
              {formatCompactIDR(product.price)}
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-neutral-500">
              {product.description}
            </p>
          </div>
        </div>

        <div className="space-y-7 px-5 pb-5">
          {hasSpice && (
            <OptionGroup label="Level pedas">
              <div className="flex flex-wrap gap-2">
                {SPICE_LEVELS.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setVariant(item.name)}
                    className={cn(
                      "rounded-full px-3.5 py-2 text-[13px] transition",
                      variant === item.name
                        ? "bg-[#FDBD2C]/20 font-medium text-neutral-900"
                        : "bg-neutral-100 text-neutral-500",
                    )}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </OptionGroup>
          )}

          {hasRice && (
            <OptionGroup label="Pilihan karbo">
              <div className="flex flex-wrap gap-2">
                {RICE_OPTIONS.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setRice(item.name)}
                    className={cn(
                      "rounded-full px-3.5 py-2 text-[13px] transition",
                      rice === item.name
                        ? "bg-[#FDBD2C]/20 font-medium text-neutral-900"
                        : "bg-neutral-100 text-neutral-500",
                    )}
                  >
                    {item.name}
                    {item.name === "Lontong" ? " · +2rb" : ""}
                  </button>
                ))}
              </div>
            </OptionGroup>
          )}

          <OptionGroup label="Tambahan" hint="opsional">
            <div className="divide-y divide-neutral-100">
              {ADDON_OPTIONS.map((item) => {
                const active = addons.includes(item.name);
                return (
                  <button
                    key={item.name}
                    onClick={() => toggleAddon(item.name)}
                    className="flex w-full items-center justify-between py-3 text-left"
                  >
                    <span
                      className={cn(
                        "text-[13px]",
                        active ? "font-medium" : "text-neutral-600",
                      )}
                    >
                      {item.name}
                    </span>
                    <span className="flex items-center gap-2.5 text-[13px] tabular-nums text-neutral-400">
                      +{formatCompactIDR(item.price)}
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border transition",
                          active
                            ? "border-[#FDBD2C] bg-[#FDBD2C] text-neutral-900"
                            : "border-neutral-200",
                        )}
                      >
                        <Plus size={11} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </OptionGroup>

          <div>
            <label className="mb-2 block text-[13px] font-medium">
              Catatan{" "}
              <span className="font-normal text-neutral-400">· opsional</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contoh: sambal dipisah"
              rows={2}
              maxLength={240}
              className="w-full resize-none rounded-2xl bg-neutral-100 px-4 py-3 text-sm outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
            />
          </div>

          <div className="sticky bottom-0 -mx-5 border-t border-neutral-100 bg-white/95 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2.5">
                <button
                  aria-label="Kurangi"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition active:scale-95"
                >
                  <Minus size={15} />
                </button>
                <span className="w-5 text-center text-sm font-medium tabular-nums">
                  {quantity}
                </span>
                <button
                  aria-label="Tambah"
                  onClick={() => setQuantity(Math.min(99, quantity + 1))}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white transition active:scale-95"
                >
                  <Plus size={15} />
                </button>
              </div>
              <button
                onClick={onAdd}
                className="flex h-12 flex-1 items-center justify-center rounded-full bg-[#FDBD2C] px-4 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
              >
                Tambah ·{" "}
                <span className="tabular-nums">{formatCompactIDR(total)}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-3 text-[13px] font-medium">
        {label}
        {hint && (
          <span className="font-normal text-neutral-400"> · {hint}</span>
        )}
      </p>
      {children}
    </div>
  );
}
