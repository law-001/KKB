"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import {
  getExpense,
  getExpenseHistory,
  getGroupMembers,
} from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";

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
 * Record a repayment. Settlements are recorded as confirmed immediately —
 * the activity feed is the audit trail.
 *
 * Overpayment is legal: it just flips the balance sign. No special-casing.
 */
export async function createSettlement(
  groupId: string,
  raw: unknown,
): Promise<Result> {
  await requireGroupMember(groupId);
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { fromUser, toUser, amountCents, method } = parsed.data;

  if (fromUser === toUser) return { error: "Payer and recipient must differ" };
  const members = await getGroupMembers(groupId);
  const recipient = members.find((m) => m.id === toUser);
  const payer = members.find((m) => m.id === fromUser);
  if (!recipient || !payer) return { error: "Both sides must be group members" };

  await db.transaction(async (tx) => {
    const [row] = await tx
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
      .returning({ id: tables.settlements.id });
    await tx.insert(tables.activityLog).values({
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
    });
  });

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

const expensePaymentSchema = z.object({
  userId: z.string().min(1),
  amountCents: z
    .number()
    .int()
    .refine((n) => Number.isSafeInteger(n) && n > 0, "Amount must be positive"),
  /** payment = person hands cash to the payer; sukli = payer gives change back */
  direction: z.enum(["payment", "sukli"]),
});

/**
 * Mark cash changing hands for one expense: a person paying their share
 * (possibly overpaying — the excess is their sukli), or the payer handing
 * the sukli back. Recorded as a settlement linked to the expense.
 */
export async function recordExpensePayment(
  expenseId: string,
  raw: unknown,
): Promise<Result> {
  const expense = await getExpense(expenseId);
  if (!expense || expense.status !== "active")
    return { error: "Expense not found" };
  await requireGroupMember(expense.groupId);

  const parsed = expensePaymentSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { userId, amountCents, direction } = parsed.data;

  const [payers, members] = await Promise.all([
    db
      .select()
      .from(tables.expensePayers)
      .where(eq(tables.expensePayers.expenseId, expenseId)),
    getGroupMembers(expense.groupId),
  ]);
  const payer = [...payers].sort((a, b) => b.amountCents - a.amountCents)[0];
  if (!payer) return { error: "This expense has no payer" };
  if (userId === payer.userId)
    return { error: "The payer doesn't pay themselves" };

  const person = members.find((m) => m.id === userId);
  const payerName = members.find((m) => m.id === payer.userId)?.name ?? "?";
  if (!person) return { error: "Not a group member" };

  const fromUser = direction === "payment" ? userId : payer.userId;
  const toUser = direction === "payment" ? payer.userId : userId;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tables.settlements)
      .values({
        groupId: expense.groupId,
        fromUser,
        toUser,
        amountCents,
        method: direction === "sukli" ? "sukli" : "cash",
        expenseId,
        settledAt: new Date(),
        status: "confirmed",
      })
      .returning({ id: tables.settlements.id });
    await tx.insert(tables.activityLog).values({
      groupId: expense.groupId,
      actorId: fromUser,
      verb: "settlement.confirmed",
      payload: {
        settlementId: row.id,
        fromName: direction === "payment" ? person.name : payerName,
        toName: direction === "payment" ? payerName : person.name,
        amountCents,
        method: direction === "sukli" ? "sukli" : "cash",
      },
    });
  });

  revalidatePath(`/groups/${expense.groupId}`);
  return { ok: true };
}

/**
 * Flip every confirmed payment between this person and the payer for this
 * expense (whole supersedes chain) to 'rejected'. The rows stay on the
 * ledger — only their effect on balances is undone.
 */
export async function unmarkExpensePayments(
  expenseId: string,
  userId: string,
): Promise<Result> {
  const expense = await getExpense(expenseId);
  if (!expense) return { error: "Expense not found" };
  await requireGroupMember(expense.groupId);

  const [history, members] = await Promise.all([
    getExpenseHistory(expenseId),
    getGroupMembers(expense.groupId),
  ]);
  const chainIds = history.map((e) => e.id);
  const person = members.find((m) => m.id === userId);
  if (!person) return { error: "Not a group member" };

  await db.transaction(async (tx) => {
    const result = await tx
      .update(tables.settlements)
      .set({ status: "rejected" })
      .where(
        and(
          inArray(tables.settlements.expenseId, chainIds),
          eq(tables.settlements.status, "confirmed"),
          or(
            eq(tables.settlements.fromUser, userId),
            eq(tables.settlements.toUser, userId),
          ),
        ),
      );
    if (result.count > 0) {
      await tx.insert(tables.activityLog).values({
        groupId: expense.groupId,
        actorId: userId,
        verb: "payment.unmarked",
        payload: {
          memberName: person.name,
          description: expense.description,
        },
      });
    }
  });

  revalidatePath(`/groups/${expense.groupId}`);
  return { ok: true };
}
