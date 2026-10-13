"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, ListFilter, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type MultiOption = { value: string; label: string; disabled?: boolean };

export function WarmMultiSelect({
  label, options, value, onChange, placeholder = "Pilih opsi", disabled = false, className,
}: {
  label: string; options: MultiOption[]; value: string[];
  onChange: (next: string[]) => void; placeholder?: string;
  disabled?: boolean; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((item) => item !== key) : [...value, key]);
  const selected = options.filter((item) => value.includes(item.value));
  return (
    <div ref={root} className={cn("relative min-w-0", className)}>
      <button id={`${id}-trigger`} type="button" aria-label={label} aria-expanded={open}
        aria-controls={`${id}-options`} disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn("flex h-11 w-full items-center justify-between gap-2 rounded-2xl bg-[#F0E9DD] px-4 text-left text-[13px] font-medium text-[#514638] disabled:opacity-50", open && "bg-[#FFFEFB] shadow-soft")}>
        <span className="flex min-w-0 items-center gap-2"><ListFilter size={16} className="shrink-0" />
          <span className="truncate">{selected.length === 0 ? placeholder : `${selected.length} status dipilih`}</span>
        </span>
        <ChevronDown size={16} className={cn("shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={`${id}-options`} role="group" aria-label={label}
          className="modern-dropdown ord-rise absolute right-0 top-[calc(100%+9px)] z-[90] w-[min(300px,85vw)] p-3">
          <div className="flex items-center justify-between px-2 py-2"><p className="text-[13px] font-semibold">Filter status</p>
            <button type="button" onClick={() => onChange([])} disabled={!value.length}
              className="flex items-center gap-1 text-[12px] text-[#857567] disabled:opacity-40"><X size={13} /> Reset</button>
          </div>
          <div className="max-h-[265px] overflow-y-auto">
            {options.map((option) => (
              <label key={option.value} className={cn("flex min-h-11 cursor-pointer items-center justify-between rounded-xl px-3 text-[13px] hover:bg-[#F5EEE1]",option.disabled && "cursor-not-allowed opacity-50")}>
                <span className="flex items-center gap-3">
                  <input type="checkbox" checked={value.includes(option.value)}
                    disabled={option.disabled} onChange={() => toggle(option.value)}
                    className="h-[17px] w-[17px] accent-[#E5A417]" />
                  {option.label}
                </span>
                {value.includes(option.value) && <Check size={15} className="text-[#B87D0D]" />}
              </label>
            ))}
          </div>
          <button type="button" onClick={() => setOpen(false)}
            className="mt-2 flex h-10 w-full items-center justify-center rounded-xl bg-[#FDBD2C] text-[13px] font-semibold">Terapkan</button>
        </div>
      )}
    </div>
  );
}
