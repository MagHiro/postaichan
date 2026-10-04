"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type WarmOption = { value: string; label: string; disabled?: boolean };

/**
 * Custom warm listbox that replaces the native `<select>`.
 * Native option popups are OS-rendered (blue highlight in the screenshot)
 * and cannot be themed — so the field keeps the `.input` look while the
 * popup is a warm white card with dividers and an accent-tinted selection.
 */
export function WarmSelect({
  id,
  label,
  value,
  options,
  onChange,
  placeholder = "Pilih",
  required = false,
  disabled = false,
  className,
}: {
  id?: string;
  label: string;
  value: string;
  options: WarmOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const fallbackId = useId();
  const fieldId = id ?? `warm-select-${fallbackId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const listId = `${fieldId}-list`;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number>(-1);
  const fieldRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((option) => option.value === value) ?? null;
  const enabledOptions = options.filter((option) => !option.disabled);

  function positionPanel() {
    const field = fieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const panelHeight = Math.min(44 + options.length * 49, 320);
    const below = window.innerHeight - rect.bottom - 12;
    const top = below >= panelHeight || below >= rect.top
      ? rect.bottom + window.scrollY + 6
      : rect.top + window.scrollY - panelHeight - 6;
    setPanelStyle({ top, left: rect.left + window.scrollX, width: rect.width });
  }

  useLayoutEffect(() => {
    if (open) positionPanel();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (
        fieldRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) return;
      setOpen(false);
    }
    function onScroll() { setOpen(false); }
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open ]);

  useEffect(() => {
    if (!open) { setHighlight(-1); return; }
    const current = options.findIndex((option) => option.value === value && !option.disabled);
    setHighlight(current >= 0 ? current : enabledOptions.length ? options.indexOf(enabledOptions[0]) : -1);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function choose(option: WarmOption) {
    if (option.disabled || disabled) return;
    onChange(option.value);
    setOpen(false);
    fieldRef.current?.focus({ preventScroll: true });
  }

  function onFieldKeyDown(event: React.KeyboardEvent) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      let next = highlight;
      for (let i = 0; i < options.length; i += 1) {
        next = (next + step + options.length) % options.length;
        if (!options[next].disabled) break;
      }
      setHighlight(next);
      panelRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[highlight];
      if (option && !option.disabled) choose(option);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <span className={cn("block min-w-0", className)}>
      <span id={`${fieldId}-label`} className="sr-only">
        {label}
      </span>
      <button
        ref={fieldRef}
        id={fieldId}
        type="button"
        role="combobox"
        aria-labelledby={`${fieldId}-label`}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => !disabled && (open ? setOpen(false) : setOpen(true))}
        onKeyDown={onFieldKeyDown}
        className={cn(
          "flex h-12 w-full items-center justify-between gap-3 rounded-2xl bg-[#F3EFE6] py-3 pl-4 pr-4 text-left text-[13px] outline-none transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
          selected ? "font-normal text-[#1C1917]" : "text-[#A8A29E]",
          open ? "bg-[#FFFEFB] ring-2 ring-[#FDBD2C]/50" : "focus:bg-[#FFFEFB] focus:ring-2 focus:ring-[#FDBD2C]/50",
        )}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? selected.label : placeholder}
        </span>
        <svg
          aria-hidden="true"
          width="12"
          height="8"
          viewBox="0 0 12 8"
          className={cn("shrink-0 transition-transform", open && "rotate-180")}
        >
          <path d="M1 1.5 6 6.5 11 1.5" fill="none" stroke="#A8A29E" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && panelStyle && createPortal(
        <div
          ref={panelRef}
          id={listId}
          role="listbox"
          aria-labelledby={`${fieldId}-label`}
          className="ord-rise fixed z-[80] max-h-[320px] overflow-y-auto rounded-2xl border border-[#EFE7D6] bg-[#FFFEFB] p-1.5 shadow-soft"
          style={{ top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
        >
          {options.map((option, index) => {
            const active = option.value === value;
            return (
              <button
                key={`${option.value}-${index}`}
                type="button"
                role="option"
                data-index={index}
                aria-selected={active}
                disabled={option.disabled}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(option)}
                className={cn(
                  "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-left text-[13px] transition disabled:cursor-not-allowed disabled:opacity-40",
                  active
                    ? "bg-[#FDBD2C]/20 font-medium text-[#1C1917]"
                    : "font-normal text-[#57534E] hover:bg-[#F3EFE6]",
                  highlight === index && !active && "bg-[#F3EFE6]",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {active && <Check aria-hidden="true" size={15} strokeWidth={2} className="shrink-0 text-[#1C1917]" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
}
