import { z } from "zod";

export const productMutationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  categoryId: z.string().uuid(),
  priceIdr: z.number().int().min(0).max(100000000),
  estimatedCostIdr: z.number().int().min(0).max(100000000),
  imageUrl: z.string().trim().max(2048).nullable().optional(),
  available: z.boolean().default(true),
});

export const tableMutationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  code: z.string().trim().regex(/^TBL-[A-Z0-9-]{1,24}$/),
  active: z.boolean(),
});
