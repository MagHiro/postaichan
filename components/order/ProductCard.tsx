"use client";

import { Heart, Plus } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { Product } from "@/lib/types";
import { cn } from "@/lib/utils";
import { badgeFor } from "./constants";
import { ProductImage } from "./ui";

export function ProductCard({
  product,
  onOpen,
  onQuickAdd,
  isFavorite = false,
  onToggleFavorite,
}: {
  product: Product;
  onOpen: (p: Product) => void;
  onQuickAdd: (p: Product) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (p: Product) => void;
}) {
  const badge = badgeFor(product);
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-neutral-100 bg-white">
      <div className="relative">
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
              "aspect-square w-full rounded-none bg-neutral-100 transition-opacity",
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
        {onToggleFavorite && (
          <span className="absolute right-2 top-2">
            <button
              type="button"
              aria-label={`${isFavorite ? "Hapus dari" : "Tambah ke"} favorit ${product.name}`}
              aria-pressed={isFavorite}
              onClick={() => onToggleFavorite(product)}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-neutral-900 backdrop-blur transition active:scale-95"
            >
              <Heart size={15} fill={isFavorite ? "currentColor" : "none"} strokeWidth={1.8} />
            </button>
          </span>
        )}
      </div>
      <div className="flex min-h-[92px] items-start justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => onOpen(product)}
          disabled={!product.available}
          className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
        >
          <h3 className="truncate text-[13px] font-medium leading-snug tracking-tight">
            {product.name}
          </h3>
          <p className="mt-0.5 truncate text-xs text-neutral-400">
            {product.description || product.category}
          </p>
          <p className="mt-0.5 text-[13px] tabular-nums text-neutral-500">
            {formatCompactIDR(product.price)}
          </p>
        </button>
        <button
          type="button"
          aria-label={`Tambah ${product.name}`}
          onClick={() => onQuickAdd(product)}
          disabled={!product.available}
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-neutral-200 bg-white transition-colors active:scale-95 disabled:opacity-30"
        >
          <Plus size={13} />
        </button>
      </div>
    </article>
  );
}
