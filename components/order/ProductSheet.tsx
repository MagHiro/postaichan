"use client";

import { useRef } from "react";
import { ArrowLeft, Heart, Minus, Plus } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { ModifierGroup, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./ui";
import { useDialogFocus } from "../use-dialog-focus";

type ProductSheetProps = {
  product: Product;
  quantity: number;
  setQuantity: (value: number) => void;
  variantOptionIds: string[];
  setVariantOptionIds: (value: string[]) => void;
  addonOptionIds: string[];
  setAddonOptionIds: (value: string[]) => void;
  note: string;
  setNote: (value: string) => void;
  onClose: () => void;
  onAdd: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (product: Product) => void;
};

export function ProductSheet({
  product,
  quantity,
  setQuantity,
  variantOptionIds,
  setVariantOptionIds,
  addonOptionIds,
  setAddonOptionIds,
  note,
  setNote,
  onClose,
  onAdd,
  isFavorite = false,
  onToggleFavorite,
}: ProductSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const groups = product.modifierGroups ?? [];
  const selectedIds = Array.from(new Set([...variantOptionIds, ...addonOptionIds]));
  const selectedOptions = groups.flatMap((group) =>
    group.options.flatMap((option) => {
      const optionQuantity = group.type === "addon"
        ? addonOptionIds.filter((id) => id === option.id).length
        : variantOptionIds.includes(option.id) ? 1 : 0;
      return Array.from({ length: optionQuantity }, () => option);
    }),
  );
  const total = (product.price + selectedOptions.reduce((sum, option) => sum + option.priceAdjustmentIdr, 0)) * quantity;
  const missingRequired = groups.some((group) => {
    const count = group.type === "addon"
      ? addonOptionIds.filter((id) => group.options.some((option) => option.id === id)).length
      : group.options.filter((option) => selectedIds.includes(option.id)).length;
    return group.required ? count < Math.max(1, group.minSelection) : count < group.minSelection;
  });

  useDialogFocus(dialogRef, onClose);

  function toggle(group: ModifierGroup, optionId: string) {
    const current = group.type === "variant" ? variantOptionIds : addonOptionIds;
    const setCurrent = group.type === "variant" ? setVariantOptionIds : setAddonOptionIds;
    const active = current.includes(optionId);
    if (active) return setCurrent(current.filter((id) => id !== optionId));
    const groupIds = group.options.map((option) => option.id);
    const withoutGroup = current.filter((id) => !groupIds.includes(id));
    if (group.selection === "single") return setCurrent([...withoutGroup, optionId]);
    if (current.filter((id) => groupIds.includes(id)).length >= group.maxSelection) return;
    setCurrent([...current, optionId]);
  }

  function changeAddonQuantity(optionId: string, nextQuantity: number) {
    const currentQuantity = addonOptionIds.filter((id) => id === optionId).length;
    const group = groups.find((candidate) => candidate.type === "addon" && candidate.options.some((option) => option.id === optionId));
    const groupCount = group ? addonOptionIds.filter((id) => group.options.some((option) => option.id === id)).length : currentQuantity;
    const maxForOption = group ? Math.max(0, group.maxSelection - (groupCount - currentQuantity)) : 99;
    const next = Math.max(0, Math.min(maxForOption, nextQuantity));
    if (next === currentQuantity) return;
    const withoutOption = addonOptionIds.filter((id) => id !== optionId);
    setAddonOptionIds([...withoutOption, ...Array.from({ length: next }, () => optionId)]);
  }

  return (
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/25" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="ord-sheet relative flex h-[100dvh] w-full max-w-[440px] flex-col overflow-hidden bg-white"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        aria-describedby="product-sheet-description"
      >
        <div className="relative shrink-0">
          <ProductImage product={product} eager className="aspect-[5/4] w-full rounded-none" />
          <div className="absolute inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] flex items-center justify-between px-4">
            <button
              type="button"
              aria-label="Kembali ke menu"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-neutral-900 backdrop-blur transition active:scale-95"
            >
              <ArrowLeft size={20} strokeWidth={1.8} />
            </button>
            {onToggleFavorite && (
              <button
                type="button"
                aria-label={`${isFavorite ? "Hapus dari" : "Tambah ke"} favorit ${product.name}`}
                aria-pressed={isFavorite}
                onClick={() => onToggleFavorite(product)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-neutral-900 backdrop-blur transition active:scale-95"
              >
                <Heart size={18} fill={isFavorite ? "currentColor" : "none"} strokeWidth={1.8} />
              </button>
            )}
          </div>
        </div>

        <div className="-mt-7 min-h-0 flex-1 overflow-y-auto rounded-t-[28px] bg-white">
          <div className="px-5 pb-36 pt-6">
            <div>
              <h2 id="product-sheet-title" className="text-lg font-medium tracking-tight">
                {product.name}
              </h2>
              <p className="mt-1 text-sm tabular-nums text-neutral-500">
                {formatCompactIDR(product.price)}
              </p>
              <p id="product-sheet-description" className="mt-2 text-[13px] leading-relaxed text-neutral-500">
                {product.description || "Disiapkan fresh sesuai pesanan."}
              </p>
            </div>

            <div className="mt-7 space-y-7">
              {groups.map((group) => (
                <OptionGroup
                  key={group.id}
                  group={group}
                  selectedIds={selectedIds}
                  selectedAddonIds={addonOptionIds}
                  onToggle={(id) => toggle(group, id)}
                  onAddonQuantityChange={changeAddonQuantity}
                />
              ))}

              <div>
                <label htmlFor="product-note" className="mb-2 block text-[13px] font-medium">
                  Catatan <span className="font-normal text-neutral-400">· opsional</span>
                </label>
                <textarea
                  id="product-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Contoh: sambal dipisah"
                  rows={2}
                  maxLength={240}
                  aria-describedby="product-note-hint"
                  className="w-full resize-none rounded-2xl bg-neutral-100 px-4 py-3 text-sm outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50"
                />
                <p id="product-note-hint" className="mt-1 text-xs text-neutral-400">
                  Maksimal 240 karakter.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="min-w-[90px] shrink-0">
              <p className="text-xs text-neutral-400">Total amount</p>
              <p className="mt-0.5 text-[15px] font-medium tabular-nums">
                {formatCompactIDR(total)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                aria-label="Kurangi jumlah"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition active:scale-95"
              >
                <Minus size={14} />
              </button>
              <span className="w-4 text-center text-[13px] font-medium tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Tambah jumlah"
                onClick={() => setQuantity(Math.min(99, quantity + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-neutral-900 text-white transition active:scale-95"
              >
                <Plus size={14} />
              </button>
            </div>
            <button
              type="button"
              onClick={onAdd}
              disabled={missingRequired}
              className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-full bg-[#FDBD2C] px-3 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
            >
              {missingRequired ? "Pilih opsi" : "Tambah ke keranjang"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OptionGroup({
  group,
  selectedIds,
  selectedAddonIds,
  onToggle,
  onAddonQuantityChange,
}: {
  group: ModifierGroup;
  selectedIds: string[];
  selectedAddonIds: string[];
  onToggle: (id: string) => void;
  onAddonQuantityChange: (id: string, quantity: number) => void;
}) {
  const selectedCount = group.type === "addon"
    ? selectedAddonIds.filter((id) => group.options.some((option) => option.id === id)).length
    : group.options.filter((option) => selectedIds.includes(option.id)).length;
  const hint = group.required
    ? `wajib · ${group.minSelection === group.maxSelection ? group.maxSelection : `${group.minSelection}–${group.maxSelection}`} pilihan`
    : "opsional";

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-3 text-[13px] font-medium">
        {group.name} <span className="font-normal text-neutral-400">· {hint}</span>
      </legend>
      {group.type === "addon" ? (
        <div className="divide-y divide-neutral-100">
          {group.options.map((option) => {
            const quantity = selectedAddonIds.filter((id) => id === option.id).length;
            const active = quantity > 0;
            const canIncrease = group.selection === "single" ? quantity < 1 : selectedCount < group.maxSelection;
            return (
              <div key={option.id} className="flex items-center gap-3 py-3">
                <button
                  type="button"
                  onClick={() => onToggle(option.id)}
                  disabled={!option.available}
                  aria-pressed={active}
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <span className={cn("block truncate text-[13px]", active ? "font-medium" : "text-neutral-600")}>
                    {option.name}{!option.available ? " · Habis" : ""}
                  </span>
                </button>
                <span className="shrink-0 text-[13px] tabular-nums text-neutral-400">
                  {option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : "Gratis"}
                </span>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onAddonQuantityChange(option.id, quantity - 1)}
                    disabled={!active}
                    aria-label={`Kurangi ${option.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition active:scale-95 disabled:opacity-30"
                  >
                    <Minus size={12} />
                  </button>
                  <span className="w-4 text-center text-[13px] font-medium tabular-nums" aria-live="polite">
                    {quantity}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAddonQuantityChange(option.id, quantity + 1)}
                    disabled={!option.available || !canIncrease}
                    aria-label={`Tambah ${option.name}`}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white transition active:scale-95 disabled:opacity-30"
                  >
                    <Plus size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {group.options.map((option) => {
            const active = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                disabled={!option.available}
                aria-pressed={active}
                className={cn(
                  "min-h-14 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "border-[#FDBD2C] bg-[#FDBD2C]/15 font-medium text-neutral-900"
                    : "border-neutral-100 bg-white text-neutral-500",
                )}
              >
                <span className="block truncate text-[13px]">
                  {option.name}{!option.available ? " · Habis" : ""}
                </span>
                {option.priceAdjustmentIdr > 0 && (
                  <span className="mt-0.5 block text-xs tabular-nums text-neutral-400">
                    +{formatCompactIDR(option.priceAdjustmentIdr)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {group.selection === "multiple" && (
        <p className="mt-2 text-xs text-neutral-400">
          Dipilih {selectedCount} dari maksimal {group.maxSelection}
        </p>
      )}
    </fieldset>
  );
}
