import { OrderExperience } from "@/components/order-experience";

export default async function GeneralOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderExperience generalToken={token} />;
}
