export type Category = string;

export type ModifierOption = {
  id: string;
  name: string;
  priceAdjustmentIdr: number;
  costAdjustmentIdr: number;
  available: boolean;
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
  type: "Dine in" | "Takeaway";
  table?: string;
  items: number;
  total: number;
  payment: "QRIS" | "Cash";
  paymentStatus: "Paid" | "Pending";
  status: "New" | "Preparing" | "Ready" | "Completed";
  time: string;
  customer?: string;
};
