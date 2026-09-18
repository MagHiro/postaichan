import { OrderExperience } from "@/components/order-experience";

// The token is intentionally not trusted in the browser. Production should resolve it
// server-side into a short-lived customer session before rendering this surface.
export default async function TableOrderPage({ params }: { params: Promise<{ tableToken: string }> }) {
  const { tableToken } = await params;
  return <OrderExperience tableToken={tableToken} />;
}
