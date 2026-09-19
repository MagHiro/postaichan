import { OrderExperience } from "@/components/order-experience";

// Legacy access-token links are treated as managed general-QR tokens.
export default async function CustomerOrderPage({ params }: { params: Promise<{ accessToken: string }> }) {
  const { accessToken } = await params;
  return <OrderExperience generalToken={accessToken} />;
}
