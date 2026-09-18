"use client";

import type { Product } from "@/lib/types";

export type OrderStep = "menu" | "configure" | "payment" | "success";

export type PaymentAttempt = {
  orderId: string;
  orderNumber: string;
  amountIdr: number;
  qrString: string;
  expiresAt: string;
};

export type PlacedOrder = {
  orderNumber: string;
  amountIdr: number;
  orderType: "Dine in" | "Takeaway";
  tableLabel: string;
  time: string;
};

export const SPICE_LEVELS = [
  { name: "No chili", hint: "Tanpa sambal" },
  { name: "Mild", hint: "Sedikit pedas" },
  { name: "Medium", hint: "Pedas pas" },
  { name: "Spicy", hint: "Pedas nampol" },
  { name: "Extra spicy", hint: "Ekstra berani" },
] as const;

export const RICE_OPTIONS = [
  { name: "No rice", hint: "Tanpa karbo" },
  { name: "Rice", hint: "Nasi hangat" },
  { name: "Lontong", hint: "+Rp 2.000" },
] as const;

export const ADDON_OPTIONS = [
  { name: "Extra sambal", price: 5000 },
  { name: "Telur mata sapi", price: 5000 },
  { name: "Kerupuk kulit", price: 5000 },
] as const;

export const ORDER_CATEGORIES = [
  "Semua Menu",
  "Sate Taichan",
  "Rice Bowl",
  "Gorengan & Kulit",
  "Minuman Segar",
  "Paket Hemat",
] as const;

export type OrderCategory = (typeof ORDER_CATEGORIES)[number];

export function matchesOrderCategory(
  product: Product,
  category: OrderCategory,
): boolean {
  switch (category) {
    case "Semua Menu":
      return true;
    case "Sate Taichan":
      return (
        product.category === "Sate Taichan" &&
        !/kulit|crispy|goreng/i.test(product.name)
      );
    case "Rice Bowl":
      return product.category === "Rice Bowl";
    case "Gorengan & Kulit":
      return /kulit|crispy|goreng|kerupuk/i.test(
        `${product.name} ${product.description}`,
      );
    case "Minuman Segar":
      return product.category === "Drinks";
    case "Paket Hemat":
      return product.popular === true;
  }
}

export type ProductBadge = { label: string; className: string };

export function badgeFor(product: Product): ProductBadge | null {
  if (!product.available)
    return { label: "Habis", className: "bg-neutral-900 text-white" };
  return null;
}

export function spiceLevelFor(product: Product): number {
  if (/kulit/i.test(product.name)) return 1;
  if (product.category === "Rice Bowl") return 2;
  if (product.options === "spice") return 3;
  return 0;
}

export function formatTableShort(tableToken?: string): string | null {
  if (!tableToken) return null;
  const match = tableToken.match(/TBL-(\d{1,3})/);
  if (match) return `Meja No. ${match[1].padStart(2, "0")}`;
  return null;
}
