"use client";

import { useState } from "react";
import { CupSoda, Drumstick, Minus, Plus, Soup, Wheat } from "lucide-react";
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
    <div className={cn("mx-auto w-full max-w-[440px] px-4", className)}>
      {children}
    </div>
  );
}

function iconFor(product: Product) {
  switch (product.category) {
    case "Sate Taichan":
      return Drumstick;
    case "Rice Bowl":
      return Soup;
    case "Drinks":
      return CupSoda;
    case "Extras":
      return Wheat;
    default:
      return Soup;
  }
}

export function ProductImage({
  product,
  className,
  iconSize = 32,
  eager = false,
  children,
}: {
  product: Product;
  className?: string;
  iconSize?: number;
  eager?: boolean;
  children?: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const Icon = iconFor(product);
  if (product.imageUrl && !failed) {
    return (
      <div className={cn("relative overflow-hidden bg-stone-100", className)}>
        <img
          src={product.imageUrl}
          alt={product.name}
          loading={eager ? "eager" : "lazy"}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {children}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-gradient-to-br text-white/90",
        product.imageTone,
        className,
      )}
    >
      <Icon size={iconSize} />
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
    <div className="flex items-center gap-1 rounded-full border border-stone-200 bg-white p-1">
      <button
        aria-label={minusLabel}
        onClick={onMinus}
        className="flex h-7 w-7 items-center justify-center rounded-full text-stone-600 transition active:scale-90"
      >
        <Minus size={13} />
      </button>
      <span className="w-5 text-center text-[13px] font-bold tabular-nums text-[#18181B]">
        {qty}
      </span>
      <button
        aria-label={plusLabel}
        onClick={onPlus}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#18181B] text-white transition active:scale-90"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-stone-200/80 bg-white p-2.5",
        className,
      )}
    >
      <div className="ord-skeleton aspect-square w-full rounded-xl" />
      <div className="space-y-2 px-1 py-3">
        <div className="ord-skeleton h-3 rounded-full" />
        <div className="ord-skeleton h-3 w-2/3 rounded-full" />
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
    <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-5 py-12 text-center">
      <p className="text-sm font-bold text-[#18181B]">{title}</p>
      {hint && <p className="mt-1 text-[13px] font-semibold text-stone-600">{hint}</p>}
    </div>
  );
}
