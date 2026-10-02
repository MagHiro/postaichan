"use client";

import type { Product } from "@/lib/types";

export type OrderStep = "menu" | "configure" | "payment" | "success";
export type PaymentAttempt = { orderId: string; orderNumber: string; amountIdr: number; qrString?: string; qrImageUrl?: string; expiresAt: string };
export type PlacedOrder = { orderNumber: string; amountIdr: number; orderType: "Dine in" | "Takeaway"; tableLabel: string; time: string };
/** Category filter is a DB category id, or "all" for every menu item. */
export type OrderCategory = string;
export const ALL_CATEGORIES_ID = "all";

export function matchesOrderCategory(product: Product, category: OrderCategory) {
  if (!category || category === ALL_CATEGORIES_ID) return true;
  if (product.categoryId) return product.categoryId === category;
  return product.category === category;
}

export type ProductBadge = { label: string; className: string };
export function badgeFor(product: Product): ProductBadge | null { return !product.available ? { label: "Habis", className: "bg-white/90 text-neutral-500" } : null; }
