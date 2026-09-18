"use client";

import { Check, Minus, Plus, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ADDON_OPTIONS, RICE_OPTIONS, SPICE_LEVELS } from "./constants";
import { Container, ProductImage } from "./ui";

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
      className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#18181B]/45"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ord-sheet max-h-[92vh] w-full max-w-[440px] overflow-y-auto rounded-t-3xl bg-[#FAF8F5]"
      >
        <div className="relative px-4 pb-4 pt-4">
          <ProductImage
            product={product}
            eager
            className="aspect-[16/10] w-full rounded-2xl"
          />
          <button
            aria-label="Tutup"
            onClick={onClose}
            className="absolute right-6 top-6 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-stone-600 shadow-sm transition active:scale-90"
          >
            <X size={16} />
          </button>
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              {product.category}
            </p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-[#18181B]">
              {product.name}
            </h2>
            <p className="mt-1 text-sm font-extrabold tabular-nums tracking-tight text-[#FF381E]">
              {formatCompactIDR(product.price)}
            </p>
          </div>
        </div>

        <Container className="space-y-5 pb-5">
          <p className="text-xs font-normal leading-relaxed text-stone-500">
            {product.description}
          </p>

          {hasSpice && (
            <OptionGroup step="1" label="Level pedas" hint="Sambal selalu fresh">
              <div className="grid grid-cols-5 gap-2">
                {SPICE_LEVELS.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setVariant(item.name)}
                    className={cn(
                      "rounded-xl border px-1 py-2.5 transition active:scale-95",
                      variant === item.name
                        ? "border-[#FF381E] bg-[#FF381E]/10 text-[#FF381E]"
                        : "border-stone-200 bg-white text-stone-500",
                    )}
                  >
                    <span className="block text-[11px] font-bold leading-tight">
                      {item.name}
                    </span>
                    <span className="mt-1 block text-[10px] leading-tight opacity-70">
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            </OptionGroup>
          )}

          {hasRice && (
            <OptionGroup
              step="1"
              label="Pilihan karbo"
              hint="Nasi hangat atau lontong pulen"
            >
              <div className="grid grid-cols-3 gap-2">
                {RICE_OPTIONS.map((item) => (
                  <button
                    key={item.name}
                    onClick={() => setRice(item.name)}
                    className={cn(
                      "rounded-xl border px-2 py-3 transition active:scale-95",
                      rice === item.name
                        ? "border-[#FF381E] bg-[#FF381E]/10 text-[#FF381E]"
                        : "border-stone-200 bg-white text-stone-500",
                    )}
                  >
                    <span className="block text-xs font-bold">{item.name}</span>
                    <span className="mt-1 block text-[10px] opacity-70">
                      {item.hint}
                    </span>
                  </button>
                ))}
              </div>
            </OptionGroup>
          )}

          <OptionGroup
            step={hasSpice || hasRice ? "2" : "1"}
            label="Tambahan"
            hint="Opsional"
          >
            <div className="space-y-2">
              {ADDON_OPTIONS.map((item) => {
                const active = addons.includes(item.name);
                return (
                  <button
                    key={item.name}
                    onClick={() => toggleAddon(item.name)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border px-3 py-3 text-left transition active:scale-[0.98]",
                      active
                        ? "border-[#FF381E] bg-red-50/50"
                        : "border-stone-200 bg-white",
                    )}
                  >
                    <span className="text-xs font-semibold text-[#18181B]">
                      {item.name}
                    </span>
                    <span className="flex items-center gap-2 text-[11px] tabular-nums text-stone-500">
                      +{formatCompactIDR(item.price)}
                      <span
                        className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border transition",
                          active
                            ? "border-[#FF381E] bg-[#FF381E] text-white"
                            : "border-stone-300 text-transparent",
                        )}
                      >
                        <Check size={12} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </OptionGroup>

          <div>
            <label className="mb-2 block text-xs font-bold text-[#18181B]">
              Catatan dapur{" "}
              <span className="font-normal text-stone-400">(opsional)</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Contoh: sambal dipisah, es sedikit"
              rows={2}
              maxLength={240}
              className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-3 text-sm text-[#18181B] outline-none transition placeholder:text-stone-400 focus:border-[#FF381E]"
            />
          </div>

          <div className="sticky bottom-0 -mx-4 border-t border-stone-200 bg-[#FAF8F5]/95 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className="flex items-center gap-3">
              <div className="flex items-center rounded-full border border-stone-200 bg-white p-1">
                <button
                  aria-label="Kurangi"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-stone-600 transition active:scale-90"
                >
                  <Minus size={15} />
                </button>
                <span className="w-7 text-center text-sm font-bold tabular-nums">
                  {quantity}
                </span>
                <button
                  aria-label="Tambah"
                  onClick={() => setQuantity(Math.min(99, quantity + 1))}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#18181B] text-white transition active:scale-90"
                >
                  <Plus size={15} />
                </button>
              </div>
              <button
                onClick={onAdd}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#FF381E] px-4 text-sm font-bold text-white shadow-md transition hover:bg-[#e03018] active:scale-[0.98]"
              >
                Tambah ·{" "}
                <span className="tabular-nums">{formatCompactIDR(total)}</span>
              </button>
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

function OptionGroup({
  step,
  label,
  hint,
  children,
}: {
  step: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-2 text-xs font-bold text-[#18181B]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#18181B] text-[10px] font-extrabold text-white">
          {step}
        </span>
        {label}
        {hint && (
          <span className="font-medium text-stone-400">· {hint}</span>
        )}
      </p>
      {children}
    </div>
  );
}
