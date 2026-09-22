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
  const fallbackTone = getFallbackTone(product);
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
        fallbackTone.surface,
        fallbackTone.ink,
      )}
    >
      <span aria-hidden="true" className="relative z-10 text-2xl font-medium tracking-tight">
        {product.name.charAt(0)}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute -right-8 -top-8 h-24 w-24 rounded-full bg-white/45",
          fallbackTone.orb,
        )}
      />
      <span
        aria-hidden="true"
        className="absolute -bottom-12 -left-8 h-28 w-28 rounded-full border-[14px] border-white/30"
      />
      {children}
    </div>
  );
}

function getFallbackTone(product: Product) {
  const source = `${product.category} ${product.name}`.toLowerCase();
  if (source.includes("sate") || source.includes("kulit")) {
    return {
      surface: "bg-[#f6e5d4]",
      ink: "text-[#a55a2b]",
      orb: "bg-[#FDBD2C]/30",
    };
  }
  if (source.includes("rice") || source.includes("nasi")) {
    return {
      surface: "bg-[#e9efe7]",
      ink: "text-[#2f8062]",
      orb: "bg-[#2f8062]/15",
    };
  }
  if (source.includes("minum") || source.includes("es") || source.includes("tea")) {
    return {
      surface: "bg-[#e8eef2]",
      ink: "text-[#4c6d7d]",
      orb: "bg-white/60",
    };
  }
  return {
    surface: "bg-[#efefeb]",
    ink: "text-neutral-500",
    orb: "bg-[#FDBD2C]/20",
  };
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
