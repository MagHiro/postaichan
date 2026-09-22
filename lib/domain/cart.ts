import type { CartItem, Product } from "@/lib/types";

export function buildCartItem(product: Product, variantOptionIds: string[], addonOptionIds: string[], quantity: number, note?: string): CartItem {
  const groups = product.modifierGroups ?? [];
  const selectedIds = Array.from(new Set([...variantOptionIds, ...addonOptionIds]));
  const selectedOptions = groups.flatMap((group) => group.options.flatMap((option) => {
    const optionQuantity = group.type === "addon"
      ? addonOptionIds.filter((id) => id === option.id).length
      : variantOptionIds.includes(option.id) ? 1 : 0;
    return Array.from({ length: optionQuantity }, () => option);
  }));
  const variants = groups.filter((group) => group.type === "variant").flatMap((group) => group.options.filter((option) => selectedIds.includes(option.id)));
  const addons = groups.filter((group) => group.type === "addon").flatMap((group) => group.options.filter((option) => selectedIds.includes(option.id)));
  const addonLabels = addons.map((option) => {
    const count = addonOptionIds.filter((id) => id === option.id).length;
    return count > 1 ? `${option.name} × ${count}` : option.name;
  });
  const cleanNote = note?.trim() || undefined;
  const key = `${product.id}-${[...variantOptionIds].sort().join("-")}-${[...addonOptionIds].sort().join("-")}-${cleanNote ?? ""}`;
  return { key, product, quantity, variantOptionIds: [...variantOptionIds], addonOptionIds: [...addonOptionIds], variantLabels: variants.map((option) => option.name), addonLabels, note: cleanNote, unitPrice: product.price + selectedOptions.reduce((sum, option) => sum + option.priceAdjustmentIdr, 0) };
}
