import { z } from 'zod';
export const cartSchema = z
  .array(z.object({ id: z.string().min(1).max(100), quantity: z.number().int().min(1).max(20) }))
  .min(1)
  .max(30)
  .refine((rows) => new Set(rows.map((x) => x.id)).size === rows.length, 'Powtórzone pozycje.');
export const checkoutSchema = z.object({
  items: cartSchema,
  idempotencyKey: z.uuid(),
  accessToken: z.string().regex(/^[a-f0-9]{64}$/),
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(60),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  phone: z.string().trim().min(7).max(25),
  shippingMethod: z.string().max(40).optional(),
  address: z
    .object({
      street: z.string().trim().min(3).max(150),
      postalCode: z.string().regex(/^\d{2}-\d{3}$/),
      city: z.string().trim().min(2).max(100),
      country: z.literal('PL'),
    })
    .optional(),
  invoice: z
    .object({
      company: z.string().min(2).max(150),
      nip: z.string().regex(/^\d{10}$/),
      address: z.string().min(5).max(250),
    })
    .optional(),
  terms: z.literal(true),
  digitalConsent: z.boolean().optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;
