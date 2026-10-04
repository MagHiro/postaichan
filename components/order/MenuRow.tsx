"use client";

import { Plus } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { badgeFor } from "./constants";
import { ProductImage } from "./ui";

export function MenuRow({
  product,
  onOpen,
  onQuickAdd,
}: {
  product: Product;
  onOpen: (p: Product) => void;
  onQuickAdd: (p: Product) => void;
}) {
  const badge = badgeFor(product);
  return (
    <article className="flex items-center gap-3 py-3.5">
      <button
        type="button"
        onClick={() => onOpen(product)}
        disabled={!product.available}
        aria-label={`Lihat ${product.name}`}
        className="relative block h-16 w-16 shrink-0 text-left transition active:scale-95 disabled:cursor-not-allowed"
      >
        <ProductImage
          product={product}
          className={cn(
            "h-16 w-16 rounded-xl bg-[#F3EFE6]",
            !product.available && "opacity-60",
          )}
        />
        {badge && (
          <span className="absolute left-1 top-1 rounded-full bg-[#FFFEFB]/90 px-1.5 py-px text-[10px] font-medium text-[#78716C] backdrop-blur">
            {badge.label}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onOpen(product)}
        disabled={!product.available}
        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
      >
        <h3 className="truncate text-[14px] font-semibold leading-snug tracking-tight">
          {product.name}
        </h3>
        <p className="mt-0.5 truncate text-xs text-[#A8A29E]">
          {product.description || product.category}
        </p>
        <p className="mt-0.5 text-[13px] tabular-nums text-[#78716C]">
          {formatCompactIDR(product.price)}
        </p>
      </button>
      <button
        type="button"
        aria-label={`Tambah ${product.name}`}
        onClick={() => onQuickAdd(product)}
        disabled={!product.available}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#E5DCC8] transition active:scale-95 disabled:opacity-30"
      >
        <Plus size={14} />
      </button>
    </article>
  );
}
