import { z } from "zod";

export const checkoutItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  variantOptionIds: z.array(z.string().uuid()).max(20).default([]),
  addonOptionIds: z.array(z.string().uuid()).max(20).default([]),
  note: z.string().trim().max(240).optional(),
});

export const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sessionToken: z.string().min(32).max(240),
  orderType: z.enum(["dine_in", "takeaway"]),
  tableToken: z.string().min(1).max(240).optional(),
  items: z.array(checkoutItemSchema).min(1).max(50),
});

export const midtransWebhookSchema = z.object({
  order_id: z.string().trim().min(1).max(120),
  status_code: z.string().regex(/^\d{3}$/),
  gross_amount: z.string().regex(/^\d{1,12}$/),
  signature_key: z.string().regex(/^[a-f0-9]{128}$/i),
  transaction_status: z.enum(["pending", "settlement", "capture", "expire", "cancel", "deny", "failure"]),
  fraud_status: z.string().max(30).optional(),
  transaction_id: z.string().trim().max(120).optional(),
  payment_type: z.string().trim().max(40).optional(),
});

export const cashierOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  orderType: z.enum(["dine_in", "takeaway"]),
  tableId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(["qris", "cash"]).default("qris"),
  items: z.array(checkoutItemSchema).min(1).max(50),
});

export const uuidParamSchema = z.string().uuid();
