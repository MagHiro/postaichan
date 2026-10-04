"use client";

import { useRef } from "react";
import { Minus, Plus, X } from "lucide-react";
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

  return (
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-[#1C1917]/30" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="ord-sheet flex h-[100dvh] w-full max-w-[440px] flex-col overflow-hidden bg-[#FFFEFB]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-sheet-title"
        aria-describedby="product-sheet-description"
      >
        <div className="relative shrink-0">
          <ProductImage product={product} eager className="aspect-square w-full" />
          <div className="absolute inset-x-0 top-[calc(0.75rem+env(safe-area-inset-top))] flex items-center justify-between px-4">
            <button
              type="button"
              aria-label="Tutup"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFFEFB]/90 text-[#1C1917] backdrop-blur transition active:scale-95"
            >
              <X size={18} strokeWidth={1.8} />
            </button>
            {product.popular && (
              <span className="rounded-full bg-[#FFFEFB]/90 px-3 py-1.5 text-[11px] font-medium text-[#1C1917] backdrop-blur">
                Populer
              </span>
            )}
          </div>
        </div>

        <div className="-mt-8 min-h-0 flex-1 overflow-y-auto rounded-t-[32px] bg-[#FFFEFB]">
          <div className="px-6 pb-40 pt-8">
            <h2 id="product-sheet-title" className="text-[22px] font-semibold leading-snug tracking-tight">
              {product.name}
            </h2>
            <p className="mt-3 text-[15px] tabular-nums text-[#78716C]">
              {formatCompactIDR(product.price)}
            </p>
            <p id="product-sheet-description" className="mt-4 text-sm leading-relaxed text-[#78716C]">
              {product.description || "Disiapkan fresh sesuai pesanan."}
            </p>

            <div className="mt-10 space-y-10">
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
                <label htmlFor="product-note" className="mb-3 block text-sm font-medium">
                  Catatan <MetaDot /> <span className="font-normal text-[#A8A29E]">opsional</span>
                </label>
                <textarea
                  id="product-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Contoh: sambal dipisah"
                  rows={3}
                  maxLength={240}
                  aria-describedby="product-note-hint"
                  className="w-full resize-none rounded-2xl bg-[#F3EFE6] px-4 py-3.5 text-sm outline-none transition placeholder:text-[#A8A29E] focus:bg-[#FFFEFB] focus:ring-2 focus:ring-[#FDBD2C]/50"
                />
                <p id="product-note-hint" className="mt-2 text-xs text-[#A8A29E]">
                  Maksimal 240 karakter.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-[#EFE7D6] bg-[#FAF7F1]/95 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[440px] items-center gap-4">
            <div className="flex shrink-0 items-center gap-2.5">
              <button
                type="button"
                aria-label="Kurangi jumlah"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E5DCC8] text-[#78716C] transition active:scale-95"
              >
                <Minus size={15} />
              </button>
              <span className="w-6 text-center text-[15px] font-medium tabular-nums" aria-live="polite">
                {quantity}
              </span>
              <button
                type="button"
                aria-label="Tambah jumlah"
                onClick={() => setQuantity(Math.min(99, quantity + 1))}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[#1C1917] text-white transition active:scale-95"
              >
                <Plus size={15} />
              </button>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[#A8A29E]">Total</p>
              <p className="mt-0.5 truncate text-base font-medium tabular-nums">
                {formatCompactIDR(total)}
              </p>
            </div>
            <button
              type="button"
              onClick={onAdd}
              disabled={missingRequired}
              className="flex h-12 min-w-0 flex-1 items-center justify-center rounded-full bg-[#FDBD2C] px-3 text-sm font-medium text-[#1C1917] transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40"
            >
              {missingRequired ? "Pilih opsi" : "Tambah"}
            </button>
          </div>
        </div>
      </div>
    </div>
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
      <legend className="mb-4 text-sm font-medium">
        {group.name} <MetaDot /> <span className="font-normal text-[#A8A29E]">{hint}</span>
      </legend>
      {group.type === "addon" ? (
        mode === "pos" ? (
          <div className="divide-y divide-[#E9E1D1]">
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
                    <span className={cn("block truncate text-[13px]", active ? "font-medium" : "text-[#57534E]")}>
                      {option.name}{!option.available ? (<> <MetaDot /> Habis</>) : null}
                    </span>
                  </button>
                  <span className="shrink-0 text-[13px] tabular-nums text-[#A8A29E]">
                    {option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : "Gratis"}
                  </span>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onAddonQuantityChange(option.id, quantity - 1)}
                      disabled={!active}
                      aria-label={`Kurangi ${option.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-[#E5DCC8] text-[#78716C] transition active:scale-95 disabled:opacity-30"
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
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1C1917] text-white transition active:scale-95 disabled:opacity-30"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="divide-y divide-[#E9E1D1]">
            {group.options.map((option) => {
              const active = selectedAddonIds.includes(option.id);
              return (
                <div key={option.id} className="flex items-center gap-4 py-4">
                  <p className={cn("min-w-0 flex-1 truncate text-sm", active ? "font-medium" : "text-[#57534E]")}>
                    {option.name}
                  </p>
                  <span className="shrink-0 text-sm tabular-nums text-[#A8A29E]">
                    {option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : "Gratis"}
                  </span>
                  <button
                    type="button"
                    onClick={() => onAddonDot(option.id)}
                    disabled={!option.available}
                    aria-pressed={active}
                    aria-label={`${active ? "Hapus" : "Tambah"} ${option.name}`}
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition active:scale-95 disabled:opacity-30",
                      active
                        ? "border-[#FDBD2C] bg-[#FDBD2C] text-[#1C1917]"
                        : "border-[#E5DCC8]",
                    )}
                  >
                    {active && <Plus size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        )
      ) : mode === "pos" ? (
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
                aria-label={`${option.name}${!option.available ? ", habis" : ""}`}
                className={cn(
                  "min-h-14 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "border-[#FDBD2C] bg-[#FDBD2C]/20 font-medium text-[#1C1917]"
                    : "border-[#EFE7D6] bg-[#FFFEFB] text-[#78716C]",
                )}
              >
                <span className="block truncate text-[13px]">
                  {option.name}
                </span>
                {option.priceAdjustmentIdr > 0 && (
                  <span className="mt-0.5 block text-xs tabular-nums text-[#A8A29E]">
                    +{formatCompactIDR(option.priceAdjustmentIdr)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2.5">
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
                  "rounded-full px-5 py-3 text-left text-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]"
                    : "bg-[#F3EFE6] text-[#78716C]",
                )}
              >
                <span className="block">{option.name}</span>
                {option.priceAdjustmentIdr > 0 && (
                  <span className="mt-0.5 block text-[13px] tabular-nums">
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
