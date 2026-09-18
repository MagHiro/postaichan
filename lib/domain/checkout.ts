export type ModifierOptionInput = {
  id: string;
  groupId: string;
  type: "variant" | "addon";
  name: string;
  priceAdjustmentIdr: number;
  costAdjustmentIdr: number;
  available: boolean;
};

export type ModifierGroupInput = {
  id: string;
  type: "variant" | "addon";
  selection: "single" | "multiple";
  required: boolean;
  minSelection: number;
  maxSelection: number;
  active: boolean;
  options: ModifierOptionInput[];
};

export type CheckoutProductInput = {
  id: string;
  name: string;
  priceIdr: number;
  estimatedCostIdr: number;
  active: boolean;
  available: boolean;
  archivedAt?: string | null;
  modifierGroups: ModifierGroupInput[];
};

export type CheckoutLineInput = {
  productId: string;
  quantity: number;
  variantOptionIds: string[];
  addonOptionIds: string[];
  note?: string;
};

export type ValidatedModifier = ModifierOptionInput;

export type ValidatedLine = CheckoutLineInput & {
  product: CheckoutProductInput;
  modifiers: ValidatedModifier[];
  unitPriceIdr: number;
  unitCostIdr: number;
  lineTotalIdr: number;
};

export type CheckoutTotals = {
  subtotalIdr: number;
  discountIdr: number;
  taxIdr: number;
  serviceChargeIdr: number;
  totalIdr: number;
  estimatedCostIdr: number;
};

export class CheckoutDomainError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CheckoutDomainError";
  }
}

function ensureSafeMoney(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_000_000_000) {
    throw new CheckoutDomainError("MONEY_LIMIT", `${label} is outside the supported money range.`);
  }
}

function uniqueIds(ids: string[], label: string) {
  if (new Set(ids).size !== ids.length) {
    throw new CheckoutDomainError("DUPLICATE_MODIFIER", `${label} contains a duplicate option.`);
  }
}

export function validateCheckoutLine(
  line: CheckoutLineInput,
  product: CheckoutProductInput | undefined,
): ValidatedLine {
  if (!product || !product.active || !product.available || product.archivedAt) {
    throw new CheckoutDomainError("MENU_CONFLICT", "A selected menu item is no longer available.");
  }
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) {
    throw new CheckoutDomainError("INVALID_QUANTITY", "Quantity must be between 1 and 99.");
  }
  if (line.note && line.note.length > 240) {
    throw new CheckoutDomainError("INVALID_NOTE", "Notes must be 240 characters or fewer.");
  }

  const selected = [
    ...line.variantOptionIds.map((id) => ({ id, type: "variant" as const })),
    ...line.addonOptionIds.map((id) => ({ id, type: "addon" as const })),
  ];
  uniqueIds(selected.map((item) => item.id), "Selected modifiers");

  const configuredTypes = new Map(
    product.modifierGroups
      .filter((group) => group.active)
      .flatMap((group) => group.options.map((option) => [option.id, group.type] as const)),
  );
  if (selected.some((item) => configuredTypes.get(item.id) !== item.type)) {
    throw new CheckoutDomainError("INVALID_MODIFIERS", "A selected option is not compatible with this product.");
  }

  const modifiers: ValidatedModifier[] = [];
  for (const group of product.modifierGroups) {
    if (!group.active) continue;
    const ids = group.type === "variant" ? line.variantOptionIds : line.addonOptionIds;
    const groupOptions = group.options.filter((option) => ids.includes(option.id));
    if (groupOptions.some((option) => !option.available)) {
      throw new CheckoutDomainError("MENU_CONFLICT", "A selected option is no longer available.");
    }
    const count = groupOptions.length;
    const minimum = group.required ? Math.max(1, group.minSelection) : group.minSelection;
    if (count < minimum || count > group.maxSelection || (group.selection === "single" && count > 1)) {
      throw new CheckoutDomainError("INVALID_MODIFIERS", `Modifier group ${group.id} has an invalid selection.`);
    }
    modifiers.push(...groupOptions);
  }

  const modifierPrice = modifiers.reduce((sum, option) => sum + option.priceAdjustmentIdr, 0);
  const modifierCost = modifiers.reduce((sum, option) => sum + option.costAdjustmentIdr, 0);
  const unitPriceIdr = product.priceIdr + modifierPrice;
  const unitCostIdr = product.estimatedCostIdr + modifierCost;
  ensureSafeMoney(unitPriceIdr, "Unit price");
  ensureSafeMoney(unitCostIdr, "Unit cost");
  const lineTotalIdr = unitPriceIdr * line.quantity;
  ensureSafeMoney(lineTotalIdr, "Line total");
  return { ...line, product, modifiers, unitPriceIdr, unitCostIdr, lineTotalIdr };
}

export function calculateTotals(
  lines: Array<Pick<ValidatedLine, "lineTotalIdr" | "unitCostIdr" | "quantity">>,
  taxBps: number,
  serviceChargeBps: number,
): CheckoutTotals {
  if (!lines.length) throw new CheckoutDomainError("EMPTY_CART", "Cart cannot be empty.");
  if (!Number.isInteger(taxBps) || taxBps < 0 || taxBps > 10_000) throw new CheckoutDomainError("INVALID_SETTINGS", "Tax setting is invalid.");
  if (!Number.isInteger(serviceChargeBps) || serviceChargeBps < 0 || serviceChargeBps > 10_000) throw new CheckoutDomainError("INVALID_SETTINGS", "Service charge setting is invalid.");
  const subtotalIdr = lines.reduce((sum, line) => sum + line.lineTotalIdr, 0);
  const estimatedCostIdr = lines.reduce((sum, line) => sum + line.unitCostIdr * line.quantity, 0);
  // Deterministic half-up rounding, calculated independently from the subtotal.
  const taxIdr = Math.floor((subtotalIdr * taxBps) / 10_000 + 0.5);
  const serviceChargeIdr = Math.floor((subtotalIdr * serviceChargeBps) / 10_000 + 0.5);
  const totalIdr = subtotalIdr + taxIdr + serviceChargeIdr;
  for (const [label, value] of Object.entries({ subtotalIdr, taxIdr, serviceChargeIdr, totalIdr, estimatedCostIdr })) ensureSafeMoney(value, label);
  return { subtotalIdr, discountIdr: 0, taxIdr, serviceChargeIdr, totalIdr, estimatedCostIdr };
}
