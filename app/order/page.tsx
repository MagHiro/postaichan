import { OrderExperience } from "@/components/order-experience";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pesan makanan" };

export default function OrderPage() {
  return <OrderExperience />;
}
