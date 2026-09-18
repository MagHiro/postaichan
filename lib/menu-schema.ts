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
