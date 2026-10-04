"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { Check, Minus, Plus, X } from "lucide-react";
import { MetaDot } from "@/components/meta";
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
  /** Customer uses pills + dot addons; POS keeps grid variants + stepper addons. */
  mode?: "customer" | "pos";
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
  mode = "customer",
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

  function toggleAddonDot(group: ModifierGroup, optionId: string) {
    const currentQuantity = addonOptionIds.filter((id) => id === optionId).length;
    if (currentQuantity > 0) return changeAddonQuantity(optionId, 0);
    const groupCount = addonOptionIds.filter((id) => group.options.some((option) => option.id === id)).length;
    if (groupCount >= group.maxSelection) return;
    changeAddonQuantity(optionId, 1);
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#1C1917]/40 p-0 sm:items-center sm:p-6 lg:p-8" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={cn(
          "ord-sheet flex w-full flex-col overflow-hidden bg-[#FFFEFB] shadow-2xl",
          // Mobile: locked bottom sheet in viewport. Tablet+: centered dialog, natural height.
          "max-h-[92dvh] rounded-t-[28px] sm:max-h-[88dvh] sm:rounded-[28px]",
          mode === "pos" ? "max-w-[440px] sm:max-w-[560px] lg:max-w-[600px]" : "max-w-[440px]",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        aria-describedby="product-sheet-description"
      >
        <div className="relative shrink-0 px-4 pt-4">
          {mode === "pos" ? (
            <div className="flex items-center gap-3.5 rounded-2xl border border-[#EFE7D6] bg-[#FAF7F1] p-3">
              <ProductImage
                product={product}
                eager
                className="h-[72px] w-[72px] shrink-0 rounded-xl"
              />
              <div className="min-w-0 flex-1">
                <h2 id="product-sheet-title" className="truncate text-[17px] font-semibold leading-tight tracking-tight">
                  {product.name}
                </h2>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-[15px] font-semibold tabular-nums text-[#1C1917]">
                    {formatCompactIDR(product.price)}
                  </p>
                  <p className="truncate text-xs text-[#A8A29E]">
                    {product.category}
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EDE8DB] text-[#57534E] transition active:scale-95"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <>
              <ProductImage
                product={product}
                eager
                className="aspect-[16/9] w-full rounded-3xl"
              >
                <div className="pointer-events-none absolute inset-0 rounded-3xl ring-1 ring-inset ring-[#1C1917]/5" />
              </ProductImage>
              <div className="absolute inset-x-7 top-7 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Tutup"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1C1917]/55 text-white backdrop-blur transition active:scale-95"
                >
                  <X size={17} strokeWidth={2} />
                </button>
                {product.popular && (
                  <span className="rounded-full bg-[#FDBD2C] px-3 py-1.5 text-[11px] font-semibold text-[#1C1917] shadow-sm">
                    Populer
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={mode === "pos" ? "px-5 pb-6 pt-4" : "px-6 pb-6 pt-5"}>
            {mode === "pos" ? (
              <p id="product-sheet-description" className="line-clamp-2 text-[13px] leading-relaxed text-[#78716C]">
                {product.description || "Disiapkan fresh sesuai pesanan."}
              </p>
            ) : (
              <>
                <h2 id="product-sheet-title" className="text-[20px] font-semibold leading-tight tracking-tight">
                  {product.name}
                </h2>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <p className="text-[16px] font-semibold tabular-nums text-[#1C1917]">
                    {formatCompactIDR(product.price)}
                  </p>
                  <p className="truncate text-xs text-[#A8A29E]">
                    {product.category}
                  </p>
                </div>
                <p id="product-sheet-description" className="mt-2.5 text-[13.5px] leading-relaxed text-[#78716C]">
                  {product.description || "Disiapkan fresh sesuai pesanan."}
                </p>
              </>
            )}

            <div className="mt-7 space-y-7">
              {groups.map((group) => (
                <OptionGroup
                  key={group.id}
                  group={group}
                  mode={mode}
                  selectedIds={selectedIds}
                  selectedAddonIds={addonOptionIds}
                  onToggle={(id) => toggle(group, id)}
                  onAddonDot={(id) => toggleAddonDot(group, id)}
                  onAddonQuantityChange={changeAddonQuantity}
                />
              ))}

              <div>
                <label htmlFor="product-note" className="mb-2.5 block text-sm font-semibold">
                  Catatan <MetaDot /> <span className="font-normal text-[#A8A29E]">opsional</span>
                </label>
                <textarea
                  id="product-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Contoh: sambal dipisah"
                  rows={2}
                  maxLength={240}
                  aria-describedby="product-note-hint"
                  className="w-full resize-none rounded-2xl border border-[#EFE7D6] bg-[#FAF7F1] px-4 py-3 text-sm outline-none transition placeholder:text-[#A8A29E] focus:border-[#FDBD2C] focus:bg-[#FFFEFB] focus:ring-2 focus:ring-[#FDBD2C]/40"
                />
                <p id="product-note-hint" className="mt-1.5 text-xs text-[#A8A29E]">
                  Maksimal 240 karakter.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-[#EFE7D6] bg-[#FFFEFB] px-5 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3.5">
          <div className="flex items-center gap-3">
            <div className="flex shrink-0 items-center gap-1 rounded-full border border-[#E5DCC8] p-1">
              <button
                type="button"
                aria-label="Kurangi jumlah"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                disabled={quantity <= 1}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#78716C] transition active:scale-95 disabled:opacity-30"
              >
                <Minus size={15} />
              </button>
              <span className="w-6 text-center text-[15px] font-semibold tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Tambah jumlah"
                onClick={() => setQuantity(Math.min(99, quantity + 1))}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1C1917] text-white transition active:scale-95"
              >
                <Plus size={15} />
              </button>
            </div>
            <button
              type="button"
              onClick={onAdd}
              disabled={missingRequired}
              className="flex h-[52px] min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-[#1C1917] px-5 text-sm font-medium text-white transition hover:bg-[#292524] active:scale-[0.98] disabled:opacity-40"
            >
              <span className="truncate">{missingRequired ? "Pilih opsi" : "Tambah"}</span>
              <span className="shrink-0 rounded-full bg-[#FDBD2C] px-3 py-1 text-[13px] font-semibold tabular-nums text-[#1C1917]">
                {formatCompactIDR(total)}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function OptionGroup({
  group,
  mode,
  selectedIds,
  selectedAddonIds,
  onToggle,
  onAddonDot,
  onAddonQuantityChange,
}: {
  group: ModifierGroup;
  mode: "customer" | "pos";
  selectedIds: string[];
  selectedAddonIds: string[];
  onToggle: (id: string) => void;
  onAddonDot: (id: string) => void;
  onAddonQuantityChange: (id: string, quantity: number) => void;
}) {
  const selectedCount = group.type === "addon"
    ? selectedAddonIds.filter((id) => group.options.some((option) => option.id === id)).length
    : group.options.filter((option) => selectedIds.includes(option.id)).length;
  const hint = group.required
    ? `wajib ${group.minSelection === group.maxSelection ? group.maxSelection : `${group.minSelection}–${group.maxSelection}`} pilihan`
    : "opsional";

  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-3 flex items-center gap-2 text-sm">
        <span className="font-semibold">{group.name}</span>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[11px] font-medium",
            group.required
              ? "bg-[#FDBD2C]/25 text-[#92400E]"
              : "bg-[#F3EFE6] text-[#A8A29E]",
          )}
        >
          {hint}
        </span>
      </legend>
      {group.type === "addon" ? (
        mode === "pos" ? (
          <div className="overflow-hidden rounded-2xl border border-[#E5DCC8]">
            {group.options.map((option, index) => {
              const quantity = selectedAddonIds.filter((id) => id === option.id).length;
              const active = quantity > 0;
              const canIncrease = group.selection === "single" ? quantity < 1 : selectedCount < group.maxSelection;
              return (
                <div key={option.id} className={cn("flex items-center gap-3 bg-[#FFFEFB] px-4 py-3", index > 0 && "border-t border-[#EFE7D6]", active && "bg-[#FDBD2C]/10")}>
                  <button
                    type="button"
                    onClick={() => onToggle(option.id)}
                    disabled={!option.available}
                    aria-pressed={active}
                    className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className={cn("block truncate text-sm leading-tight", active ? "font-semibold text-[#1C1917]" : "font-medium text-[#44403C]")}>
                      {option.name}{!option.available ? (<span className="font-normal text-[#A8A29E]"> · Habis</span>) : null}
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-[#A8A29E]">
                      {option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : "Gratis"}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onAddonQuantityChange(option.id, quantity - 1)}
                      disabled={!active}
                      aria-label={`Kurangi ${option.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5DCC8] text-[#78716C] transition active:scale-95 disabled:opacity-30"
                    >
                      <Minus size={13} />
                    </button>
                    <span className="w-5 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                      {quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onAddonQuantityChange(option.id, quantity + 1)}
                      disabled={!option.available || !canIncrease}
                      aria-label={`Tambah ${option.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1C1917] text-white transition active:scale-95 disabled:opacity-30"
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#EFE7D6]">
            {group.options.map((option, index) => {
              const active = selectedAddonIds.includes(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onAddonDot(option.id)}
                  disabled={!option.available}
                  aria-pressed={active}
                  aria-label={`${active ? "Hapus" : "Tambah"} ${option.name}`}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-3.5 text-left transition active:bg-[#F3EFE6] disabled:cursor-not-allowed disabled:opacity-40",
                    index > 0 && "border-t border-[#EFE7D6]",
                    active && "bg-[#FDBD2C]/10",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition",
                      active
                        ? "border-[#1C1917] bg-[#1C1917] text-white"
                        : "border-[#E5DCC8] text-transparent",
                    )}
                  >
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-sm", active ? "font-semibold" : "font-normal text-[#44403C]")}>
                      {option.name}
                    </span>
                    <span className="mt-0.5 block text-xs tabular-nums text-[#A8A29E]">
                      {option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : "Gratis"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : mode === "pos" ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {group.options.map((option) => {
            const active = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                disabled={!option.available}
                aria-pressed={active}
                aria-label={`${option.name}${!option.available ? ", habis" : ""}`}
                className={cn(
                  "flex min-h-[56px] flex-col justify-center rounded-2xl border px-3.5 py-2.5 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "border-[#1C1917] bg-[#1C1917] text-white shadow-sm"
                    : "border-[#E5DCC8] bg-[#FFFEFB] text-[#44403C] hover:border-[#A8A29E]",
                )}
              >
                <span className={cn("block truncate text-[13px] leading-tight", active ? "font-semibold" : "font-medium")}>
                  {option.name}
                  {!option.available ? " · Habis" : ""}
                </span>
                {option.priceAdjustmentIdr > 0 && (
                  <span className={cn("mt-1 block text-xs tabular-nums", active ? "text-white/70" : "text-[#A8A29E]")}>
                    +{formatCompactIDR(option.priceAdjustmentIdr)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {group.options.map((option) => {
            const active = selectedIds.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onToggle(option.id)}
                disabled={!option.available}
                aria-pressed={active}
                aria-label={`${option.name}${option.priceAdjustmentIdr > 0 ? `, tambah ${formatCompactIDR(option.priceAdjustmentIdr)}` : ""}${!option.available ? ", habis" : ""}`}
                className={cn(
                  "min-h-[44px] rounded-2xl border px-4 py-2.5 text-left text-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "border-[#1C1917] bg-[#1C1917] font-medium text-white shadow-sm"
                    : "border-[#EFE7D6] bg-[#FAF7F1] text-[#57534E]",
                )}
              >
                <span className="block leading-tight">{option.name}</span>
                {option.priceAdjustmentIdr > 0 && (
                  <span className={cn("mt-0.5 block text-xs tabular-nums", active ? "text-white/70" : "text-[#A8A29E]")}>
                    +{formatCompactIDR(option.priceAdjustmentIdr)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {group.selection === "multiple" && mode === "pos" && (
        <p className="mt-2 text-xs text-[#A8A29E]">
          Dipilih {selectedCount} dari maksimal {group.maxSelection}
        </p>
      )}
    </fieldset>
  );
}
