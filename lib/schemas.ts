import { z } from "zod";

export const checkoutItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  variantOptionIds: z.array(z.string().uuid()).max(20).default([]),
  addonOptionIds: z.array(z.string().uuid()).max(20).default([]),
  variantNames: z.array(z.string().trim().max(80)).max(20).default([]),
  addonNames: z.array(z.string().trim().max(80)).max(20).default([]),
  note: z.string().trim().max(240).optional(),
});

export const checkoutSchema = z.object({
  idempotencyKey: z.string().min(16).max(120),
  sessionToken: z.string().min(32).max(240),
  orderType: z.enum(["dine_in", "takeaway"]),
  tableToken: z.string().min(1).max(240).optional(),
  items: z.array(checkoutItemSchema).min(1).max(50),
});

export const midtransWebhookSchema = z.object({
  order_id: z.string().min(1),
  status_code: z.string(),
  gross_amount: z.string(),
  signature_key: z.string(),
  transaction_status: z.string(),
  fraud_status: z.string().optional(),
  transaction_id: z.string().optional(),
  payment_type: z.string().optional(),
});
