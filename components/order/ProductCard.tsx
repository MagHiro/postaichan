"use client";

import { Plus } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { badgeFor } from "./constants";
import { ProductImage } from "./ui";

export function ProductCard({
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
    <article className="group flex min-w-0 flex-col">
      <button
        type="button"
        onClick={() => onOpen(product)}
        disabled={!product.available}
        aria-label={`Lihat ${product.name}`}
        className="block w-full text-left disabled:cursor-not-allowed"
      >
        <ProductImage
          product={product}
          className={cn(
            "aspect-square w-full rounded-[22px] bg-neutral-100 transition-opacity",
            !product.available && "opacity-60",
          )}
        >
          {badge && (
            <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-neutral-500 backdrop-blur">
              {badge.label}
            </span>
          )}
        </ProductImage>
      </button>
      <div className="mt-3 flex items-start justify-between gap-2 px-0.5">
        <button
          type="button"
          onClick={() => onOpen(product)}
          disabled={!product.available}
          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
        >
          <h3 className="truncate text-[13px] font-medium leading-snug tracking-tight">
            {product.name}
          </h3>
          <p className="mt-0.5 text-[13px] tabular-nums text-neutral-500">
            {formatCompactIDR(product.price)}
          </p>
          {product.stockTracked && product.available && <p className="mt-0.5 text-xs tabular-nums text-neutral-400">{product.stockQuantity ?? 0} tersisa</p>}
        </button>
        <button
          type="button"
          aria-label={`Tambah ${product.name}`}
          onClick={() => onQuickAdd(product)}
          disabled={!product.available}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white transition-colors active:scale-95 disabled:opacity-30"
        >
          <Plus size={13} />
        </button>
      </div>
    </article>
  );
}
