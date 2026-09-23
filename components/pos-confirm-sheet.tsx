"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/components/use-dialog-focus";

export type ConfirmState = {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
};

export function ConfirmSheet({ confirm, onClose }: { confirm: ConfirmState | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  useDialogFocus(dialogRef, onClose, confirm !== null);
  if (!confirm) return null;
  return createPortal(
    <div className="ord-backdrop fixed inset-0 z-[70] flex items-end justify-center bg-neutral-900/30 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="ord-sheet w-full max-w-[440px] rounded-t-[28px] bg-white p-5 text-neutral-900 sm:rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-sheet-title"
        aria-describedby="confirm-sheet-description"
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-neutral-200" />
        <h2 id="confirm-sheet-title" className="mt-4 text-[15px] font-medium tracking-tight">{confirm.title}</h2>
        <p id="confirm-sheet-description" className="mt-1 text-[13px] leading-relaxed text-neutral-500">{confirm.description}</p>
        <div className="mt-5 space-y-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => { onClose(); confirm.onConfirm(); }}
            className="h-12 w-full rounded-full bg-[#FDBD2C] text-sm font-medium text-neutral-900 transition hover:bg-[#ECA90F] active:scale-[0.98]"
          >
            {confirm.confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-12 w-full rounded-full text-sm text-neutral-500 active:scale-[0.98]"
          >
            Batal
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
