export type Category = {
  id: string;
  name: string;
  description?: string | null;
  displayOrder?: number;
  active?: boolean;
};

export type ModifierOption = {
  id: string;
  name: string;
  priceAdjustmentIdr: number;
  costAdjustmentIdr: number;
  available: boolean;
  stockTracked?: boolean;
  stockQuantity?: number;
};

export type ModifierGroup = {
  id: string;
  name: string;
  type: "variant" | "addon";
  selection: "single" | "multiple";
  required: boolean;
  minSelection: number;
  maxSelection: number;
  options: ModifierOption[];
};

export type Product = {
  id: string;
  name: string;
  description: string;
  category: string;
  categoryId?: string;
  price: number;
  cost: number;
  available: boolean;
  stockTracked?: boolean;
  stockQuantity?: number;
  active?: boolean;
  popular?: boolean;
  modifierGroups?: ModifierGroup[];
  accent: string;
  imageTone: string;
  imageUrl?: string | null;
  // Kept only for compatibility with the legacy POS view. Customer ordering
  // must use modifierGroups, never these display shortcuts.
  options?: "spice" | "rice" | "none";
};

export type CartItem = {
  key: string;
  product: Product;
  quantity: number;
  variantOptionIds: string[];
  addonOptionIds: string[];
  variantLabels: string[];
  addonLabels: string[];
  note?: string;
  unitPrice: number;
};

export type Order = {
  id: string;
  number: string;
  table?: string;
  items: number;
  total: number;
  payment: "QRIS" | "Cash";
  paymentStatus: "Paid" | "Pending" | "Failed" | "Expired" | "Partially refunded" | "Refunded" | "Needs reconciliation" | "Unavailable";
  status: "Pending" | "New" | "Accepted" | "Preparing" | "Ready" | "Completed" | "Cancelled" | "Refunded";
  time: string;
  customer?: string;
};
