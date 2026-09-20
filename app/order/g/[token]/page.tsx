import { OrderExperience } from "@/components/order-experience";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pesan makanan" };

export default async function GeneralOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderExperience generalToken={token} />;
}
