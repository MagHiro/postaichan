import { z } from "zod";

export const checkoutItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(99),
  variantOptionIds: z.array(z.string().uuid()).max(20).default([]),
  addonOptionIds: z.array(z.string().uuid()).max(20).default([]),
  note: z.string().trim().max(240).optional(),
}).strict();

export const checkoutSchema = z.object({
  idempotencyKey: z.string().uuid(),
  sessionToken: z.string().min(32).max(240),
  items: z.array(checkoutItemSchema).min(1).max(50),
}).strict();

export const customerSessionSchema = z.object({
  tableToken: z.string().trim().min(32).max(240).optional(),
  generalToken: z.string().trim().min(32).max(240).optional(),
  tableId: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  if (value.tableToken && value.generalToken) {
    context.addIssue({ code: "custom", message: "Only one QR context may be supplied.", path: ["tableToken"] });
  }
  if (value.tableToken && value.tableId) {
    context.addIssue({ code: "custom", message: "Table QR already defines the table.", path: ["tableId"] });
  }
});

export const midtransWebhookSchema = z.object({
  // These four strings feed Midtrans' SHA-512 signature. Keep them byte-for-byte
  // as received; normalization before verification would change the signed input.
  order_id: z.string().min(1).max(120),
  status_code: z.string().regex(/^\d{3}$/),
  gross_amount: z.string().min(1).max(40),
  signature_key: z.string().regex(/^[a-f0-9]{128}$/i),
  // Verify the signature over this exact string, then safely acknowledge any
  // future provider state that is not actionable for QRIS.
  transaction_status: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  fraud_status: z.string().max(30).optional(),
  transaction_id: z.string().max(120).optional(),
  payment_type: z.string().max(40).optional(),
  transaction_time: z.string().max(80).optional(),
  settlement_time: z.string().max(80).optional(),
}).passthrough();

export const cashierOrderSchema = z.object({
  idempotencyKey: z.string().uuid(),
  tableId: z.string().uuid().nullable().optional(),
  paymentMethod: z.enum(["qris", "cash"]).default("qris"),
  items: z.array(checkoutItemSchema).min(1).max(50),
}).strict();

export const uuidParamSchema = z.string().uuid();

export const shiftIntakeItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(0).max(1000000),
}).strict();

export const shiftOpenSchema = z.object({
  note: z.string().trim().max(240).optional(),
  items: z.array(shiftIntakeItemSchema).max(500),
}).strict();

export const shiftCloseSchema = z.object({
  note: z.string().trim().max(240).optional(),
}).strict();
