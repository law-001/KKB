"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getGroupMembers, isMember } from "@/lib/db/queries";

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
 * Record a repayment. Status starts 'pending' and only 'confirmed' rows count
 * toward balances — the recipient confirms (prevents "I marked it paid but
 * never paid"). Auto-confirmed when the recipient can't tap buttons (a ghost)
 * or IS the actor recording money they received.
 *
 * Overpayment is legal: it just flips the balance sign. No special-casing.
 */
export async function createSettlement(
  groupId: string,
  raw: unknown,
): Promise<Result> {
  const user = await requireUser();
  if (!isMember(groupId, user.id)) return { error: "Not a member of this group" };

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromUser, toUser, amountCents, method } = parsed.data;

  if (fromUser === toUser) return { error: "Payer and recipient must differ" };
  if (fromUser !== user.id && toUser !== user.id) {
    // Recording on behalf of a ghost is fine; two strangers is not.
    const members = getGroupMembers(groupId);
    const from = members.find((m) => m.id === fromUser);
    const to = members.find((m) => m.id === toUser);
    if (from?.email !== null && to?.email !== null) {
      return { error: "You must be part of the settlement (or one side is a ghost)" };
    }
  }
  const members = getGroupMembers(groupId);
  const recipient = members.find((m) => m.id === toUser);
  const payer = members.find((m) => m.id === fromUser);
  if (!recipient || !payer) return { error: "Both sides must be group members" };

  const recipientIsGhost = recipient.email === null;
  const status =
    recipientIsGhost || toUser === user.id ? "confirmed" : "pending";

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
        status,
      })
      .returning({ id: tables.settlements.id })
      .get();
    tx.insert(tables.activityLog)
      .values({
        groupId,
        actorId: user.id,
        verb: status === "confirmed" ? "settlement.confirmed" : "settlement.recorded",
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

async function transition(
  settlementId: string,
  to: "confirmed" | "rejected",
): Promise<Result> {
  const user = await requireUser();
  const settlement = db
    .select()
    .from(tables.settlements)
    .where(eq(tables.settlements.id, settlementId))
    .get();
  if (!settlement) return { error: "Settlement not found" };
  if (settlement.toUser !== user.id) {
    return { error: "Only the recipient can confirm or reject" };
  }

  const changed = db.transaction((tx) => {
    const result = tx
      .update(tables.settlements)
      .set({ status: to })
      .where(
        and(
          eq(tables.settlements.id, settlementId),
          eq(tables.settlements.status, "pending"),
        ),
      )
      .run();
    if (result.changes !== 1) return false;
    tx.insert(tables.activityLog)
      .values({
        groupId: settlement.groupId,
        actorId: user.id,
        verb: `settlement.${to}`,
        payload: { settlementId, amountCents: settlement.amountCents },
      })
      .run();
    return true;
  });

  if (!changed) return { error: "Settlement is no longer pending" };
  revalidatePath(`/groups/${settlement.groupId}`);
  return { ok: true };
}

export async function confirmSettlement(settlementId: string): Promise<Result> {
  return transition(settlementId, "confirmed");
}

export async function rejectSettlement(settlementId: string): Promise<Result> {
  return transition(settlementId, "rejected");
}
