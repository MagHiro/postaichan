"use client";

import { Plus } from "lucide-react";
import { formatCompactIDR } from "@/lib/format";
import type { Product } from "@/lib/types";
import { badgeFor, spiceLevelFor } from "./constants";
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
  const spice = spiceLevelFor(product);
  return (
    <article className="group flex flex-col justify-between rounded-2xl border border-stone-200/80 bg-white p-2.5 shadow-xs transition-all hover:shadow-md">
      <div>
        <div className="mb-2">
          <ProductImage
            product={product}
            className="aspect-square w-full overflow-hidden rounded-xl"
          >
            {badge && (
              <span
                className={`absolute left-2 top-2 flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider shadow-sm ${badge.className}`}
              >
                {badge.label}
              </span>
            )}
            {spice > 0 && (
              <div className="absolute bottom-1.5 left-2 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
                <span>{"🌶️".repeat(spice)}</span>
              </div>
            )}
          </ProductImage>
        </div>
        <button
          onClick={() => onOpen(product)}
          disabled={!product.available}
          className="block w-full text-left disabled:cursor-not-allowed"
        >
          <h3 className="line-clamp-1 text-xs font-bold leading-snug text-[#18181B]">
            {product.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-stone-500">
            {product.description}
          </p>
        </button>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2">
        <div>
          <span className="block text-[10px] font-medium text-stone-400">
            Harga
          </span>
          <span className="text-xs font-black text-[#18181B]">
            {formatCompactIDR(product.price)}
          </span>
        </div>
        <button
          aria-label={`Tambah ${product.name}`}
          onClick={() => onQuickAdd(product)}
          disabled={!product.available}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[#18181B] text-white shadow-sm transition-all hover:bg-[#FF381E] active:scale-95 disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
    </article>
  );
}
