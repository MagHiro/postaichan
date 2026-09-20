"use client";

import { useRef } from "react";
import { Minus, Plus, X } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { ModifierGroup, Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ProductImage } from "./ui";
import { useDialogFocus } from "../use-dialog-focus";

export function ProductSheet({ product, quantity, setQuantity, variantOptionIds, setVariantOptionIds, addonOptionIds, setAddonOptionIds, note, setNote, onClose, onAdd }: {
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
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const groups = product.modifierGroups ?? [];
  const selectedIds = [...variantOptionIds, ...addonOptionIds];
  const selectedOptions = groups.flatMap((group) => group.options.filter((option) => selectedIds.includes(option.id)));
  const total = (product.price + selectedOptions.reduce((sum, option) => sum + option.priceAdjustmentIdr, 0)) * quantity;
  const missingRequired = groups.some((group) => {
    const count = group.options.filter((option) => selectedIds.includes(option.id)).length;
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

  return (
    <div className="ord-backdrop fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/30" onClick={onClose}>
      <div ref={dialogRef} tabIndex={-1} onClick={(event) => event.stopPropagation()} className="ord-sheet max-h-[92vh] w-full max-w-[440px] overflow-y-auto rounded-t-[28px] bg-white" role="dialog" aria-modal="true" aria-labelledby="product-sheet-title" aria-describedby="product-sheet-description">
        <div className="px-5 pb-4 pt-3">
          <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-neutral-200" />
          <div className="relative"><ProductImage product={product} eager className="aspect-[16/10] w-full rounded-2xl" /><button type="button" aria-label="Tutup pilihan produk" onClick={onClose} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-neutral-500 backdrop-blur transition active:scale-95"><X size={15} /></button></div>
          <div className="mt-4"><h2 id="product-sheet-title" className="text-lg font-medium tracking-tight">{product.name}</h2><p className="mt-0.5 text-sm tabular-nums text-neutral-500">{formatCompactIDR(product.price)}</p><p id="product-sheet-description" className="mt-2 text-[13px] leading-relaxed text-neutral-500">{product.description}</p></div>
        </div>
        <div className="space-y-7 px-5 pb-5">
          {groups.map((group) => <OptionGroup key={group.id} group={group} selectedIds={selectedIds} onToggle={(id) => toggle(group, id)} />)}
          <div><label htmlFor="product-note" className="mb-2 block text-[13px] font-medium">Catatan <span className="font-normal text-neutral-400">· opsional</span></label><textarea id="product-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Contoh: sambal dipisah" rows={2} maxLength={240} aria-describedby="product-note-hint" className="w-full resize-none rounded-2xl bg-neutral-100 px-4 py-3 text-sm outline-none transition placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-[#FDBD2C]/50" /><p id="product-note-hint" className="mt-1 text-xs text-neutral-400">Maksimal 240 karakter.</p></div>
          <div className="sticky bottom-0 -mx-5 border-t border-neutral-100 bg-white/95 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 backdrop-blur"><div className="flex items-center gap-3"><div className="flex items-center gap-2.5"><button type="button" aria-label="Kurangi jumlah" onClick={() => setQuantity(Math.max(1, quantity - 1))} className="flex h-10 w-10 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition active:scale-95"><Minus size={15} /></button><span className="w-5 text-center text-sm font-medium tabular-nums" aria-live="polite">{quantity}</span><button type="button" aria-label="Tambah jumlah" onClick={() => setQuantity(Math.min(99, quantity + 1))} className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900 text-white transition active:scale-95"><Plus size={15} /></button></div><button type="button" onClick={onAdd} disabled={missingRequired} className="flex h-12 flex-1 items-center justify-center rounded-full bg-[#FDBD2C] px-4 text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98] disabled:opacity-40">{missingRequired ? "Pilih opsi wajib" : <>Tambah · <span className="tabular-nums">{formatCompactIDR(total)}</span></>}</button></div></div>
        </div>
      </div>
    </div>
  );
}

function OptionGroup({ group, selectedIds, onToggle }: { group: ModifierGroup; selectedIds: string[]; onToggle: (id: string) => void }) {
  const selectedCount = group.options.filter((option) => selectedIds.includes(option.id)).length;
  const hint = group.required ? `wajib · ${group.minSelection === group.maxSelection ? group.maxSelection : `${group.minSelection}–${group.maxSelection}`} pilihan` : "opsional";
  return (
    <fieldset className="min-w-0 border-0 p-0">
      <legend className="mb-3 text-[13px] font-medium">{group.name} <span className="font-normal text-neutral-400">· {hint}</span></legend>
      {group.type === "addon" ? (
        <div className="divide-y divide-neutral-100">
          {group.options.map((option) => {
            const active = selectedIds.includes(option.id);
            return <button key={option.id} type="button" onClick={() => onToggle(option.id)} disabled={!option.available} className="flex w-full items-center justify-between py-3 text-left disabled:cursor-not-allowed disabled:opacity-40" aria-pressed={active}><span className={cn("text-[13px]", active ? "font-medium" : "text-neutral-600")}>{option.name}{!option.available ? " · Habis" : ""}</span><span className="flex items-center gap-2.5 text-[13px] tabular-nums text-neutral-400">{option.priceAdjustmentIdr > 0 ? `+${formatCompactIDR(option.priceAdjustmentIdr)}` : ""}<span className={cn("flex h-5 w-5 items-center justify-center rounded-full border transition", active ? "border-[#FDBD2C] bg-[#FDBD2C] text-neutral-900" : "border-neutral-200")}><Plus size={11} /></span></span></button>;
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {group.options.map((option) => {
            const active = selectedIds.includes(option.id);
            return <button key={option.id} type="button" onClick={() => onToggle(option.id)} disabled={!option.available} aria-pressed={active} className={cn("rounded-full px-3.5 py-2 text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40", active ? "bg-[#FDBD2C]/20 font-medium text-neutral-900" : "bg-neutral-100 text-neutral-500")}>{option.name}{!option.available ? " · Habis" : option.priceAdjustmentIdr > 0 ? ` · +${formatCompactIDR(option.priceAdjustmentIdr)}` : ""}</button>;
          })}
        </div>
      )}
      {group.selection === "multiple" && <p className="mt-2 text-xs text-neutral-400">Dipilih {selectedCount} dari maksimal {group.maxSelection}</p>}
    </fieldset>
  );
}
