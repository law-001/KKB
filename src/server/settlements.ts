"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import { getGroupMembers } from "@/lib/db/queries";

interface Result {
  ok?: boolean;
  error?: string;
}

const createSchema = z.object({
  fromUser: z.string().min(1),
  toUser: z.string().min(1),
  amountCents: z
    .number()
    .int()
    .refine((n) => Number.isSafeInteger(n) && n > 0, "Amount must be positive"),
  method: z.string().trim().max(40).optional(),
});

/**
 * Record a repayment. With no accounts there's no one to route a
 * confirmation to, so settlements are recorded as confirmed immediately —
 * the activity feed is the audit trail.
 *
 * Overpayment is legal: it just flips the balance sign. No special-casing.
 */
export async function createSettlement(
  groupId: string,
  raw: unknown,
): Promise<Result> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromUser, toUser, amountCents, method } = parsed.data;

  if (fromUser === toUser) return { error: "Payer and recipient must differ" };
  const members = getGroupMembers(groupId);
  const recipient = members.find((m) => m.id === toUser);
  const payer = members.find((m) => m.id === fromUser);
  if (!recipient || !payer) return { error: "Both sides must be group members" };

  db.transaction((tx) => {
    const row = tx
      .insert(tables.settlements)
      .values({
        groupId,
        fromUser,
        toUser,
        amountCents,
        method: method || null,
        settledAt: new Date(),
        status: "confirmed",
      })
      .returning({ id: tables.settlements.id })
      .get();
    tx.insert(tables.activityLog)
      .values({
        groupId,
        actorId: fromUser,
        verb: "settlement.confirmed",
        payload: {
          settlementId: row.id,
          fromName: payer.name,
          toName: recipient.name,
          amountCents,
          method: method || null,
        },
      })
      .run();
  });

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}
