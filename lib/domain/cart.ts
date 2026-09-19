import type { CartItem, Product } from "@/lib/types";

export function buildCartItem(product: Product, variantOptionIds: string[], addonOptionIds: string[], quantity: number, note?: string): CartItem {
  const groups = product.modifierGroups ?? [];
  const selectedIds = [...variantOptionIds, ...addonOptionIds];
  const selectedOptions = groups.flatMap((group) => group.options.filter((option) => selectedIds.includes(option.id)));
  const variants = selectedOptions.filter((option) => groups.some((group) => group.type === "variant" && group.options.some((candidate) => candidate.id === option.id)));
  const addons = selectedOptions.filter((option) => groups.some((group) => group.type === "addon" && group.options.some((candidate) => candidate.id === option.id)));
  const cleanNote = note?.trim() || undefined;
  const key = `${product.id}-${[...variantOptionIds].sort().join("-")}-${[...addonOptionIds].sort().join("-")}-${cleanNote ?? ""}`;
  return { key, product, quantity, variantOptionIds: [...variantOptionIds], addonOptionIds: [...addonOptionIds], variantLabels: variants.map((option) => option.name), addonLabels: addons.map((option) => option.name), note: cleanNote, unitPrice: product.price + selectedOptions.reduce((sum, option) => sum + option.priceAdjustmentIdr, 0) };
}
