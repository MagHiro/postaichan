import { z } from "zod";

export const productMutationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  categoryId: z.string().uuid(),
  priceIdr: z.number().int().min(0).max(100000000),
  estimatedCostIdr: z.number().int().min(0).max(100000000),
  imagePath: z.string().trim().regex(/^\/uploads\/menu\/[A-Za-z0-9_-]+\.webp$/).nullable().optional(),
  available: z.boolean().default(true),
  stockTracked: z.boolean().default(false),
  stockQuantity: z.number().int().min(0).max(1000000).default(0),
}).strict();

export const tableMutationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  code: z.string().trim().regex(/^TBL-[A-Z0-9-]{1,24}$/),
  active: z.boolean(),
}).strict();
