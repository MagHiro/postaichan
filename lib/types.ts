export type Category = "Semua" | "Sate Taichan" | "Rice Bowl" | "Extras" | "Drinks";

export type Product = {
  id: string;
  name: string;
  description: string;
  category: Exclude<Category, "Semua">;
  price: number;
  cost: number;
  available: boolean;
  accent: string;
  imageTone: string;
  imageUrl?: string | null;
  popular?: boolean;
  options?: "spice" | "rice" | "none";
};

export type CartItem = {
  key: string;
  product: Product;
  quantity: number;
  variant?: string;
  addons: string[];
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
