import { OrderExperience } from "@/components/order-experience";

// Customer order status is access-token scoped, never table scoped.
export default function CustomerOrderPage() {
  return <OrderExperience />;
}
