/**
 * The expense payload shared by client (form) and server (action validation).
 * Lives outside the "use server" module because action files may only export
 * async functions.
 */
import { z } from "zod";
import { splitInputSchema } from "@/lib/ledger/split";

const cents = z.number().int().refine(Number.isSafeInteger);

export const expensePayloadSchema = z.object({
  description: z.string().trim().min(1, "Description is required").max(140),
  totalCents: cents.refine((n) => n > 0, "Total must be positive"),
  /** When the money was spent — backdating is a feature, not a bug. */
  paidAt: z.iso.date("Enter a valid date"),
  notes: z.string().trim().max(500).optional(),
  payers: z
    .array(
      z.object({
        userId: z.string().min(1),
        amountCents: cents.refine((n) => n > 0),
      }),
    )
    .min(1, "At least one payer"),
  split: splitInputSchema,
});

export type ExpensePayload = z.infer<typeof expensePayloadSchema>;
