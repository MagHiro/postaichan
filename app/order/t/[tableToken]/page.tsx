import { OrderExperience } from "@/components/order-experience";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pesan dari meja" };

// The token is only used to request a server-validated short-lived customer session.
export default async function TableOrderPage({ params }: { params: Promise<{ tableToken: string }> }) {
  const { tableToken } = await params;
  return <OrderExperience tableToken={tableToken} />;
}
