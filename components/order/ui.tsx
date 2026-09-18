"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Container({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-[440px] px-5", className)}>
      {children}
    </div>
  );
}

export function ProductImage({
  product,
  className,
  eager = false,
  children,
}: {
  product: Product;
  className?: string;
  /** Kept for compatibility; the minimal placeholder ignores it. */
  iconSize?: number;
  eager?: boolean;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  if (product.imageUrl && !failed) {
    return (
      <div className={cn("relative overflow-hidden bg-neutral-100", className)}>
        <img
          src={product.imageUrl}
          alt={product.name}
          loading={eager ? "eager" : "lazy"}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-neutral-100 text-neutral-400",
        className,
      )}
    >
      <span className="text-lg font-medium">{product.name.charAt(0)}</span>
      {children}
    </div>
  );
}

export function QtyStepper({
  qty,
  onMinus,
  onPlus,
  minusLabel,
  plusLabel,
}: {
  qty: number;
  onMinus: () => void;
  onPlus: () => void;
  minusLabel: string;
  plusLabel: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <button
        aria-label={minusLabel}
        onClick={onMinus}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition active:scale-95"
      >
        <Minus size={13} />
      </button>
      <span className="w-4 text-center text-[13px] font-medium tabular-nums">
        {qty}
      </span>
      <button
        aria-label={plusLabel}
        onClick={onPlus}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-neutral-900 text-white transition active:scale-95"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="ord-skeleton aspect-square w-full rounded-2xl" />
      <div className="mt-3 space-y-2 px-0.5">
        <div className="ord-skeleton h-3 w-3/4 rounded-full" />
        <div className="ord-skeleton h-3 w-1/2 rounded-full" />
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="py-14 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && (
        <p className="mt-1 text-[13px] text-neutral-500">{hint}</p>
      )}
    </div>
  );
}
