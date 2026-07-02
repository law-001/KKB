"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, tables, type DB } from "@/lib/db";
import { getExpense, getGroup, getGroupMembers } from "@/lib/db/queries";
import { computeShares, SplitError, type SplitInput } from "@/lib/ledger/split";
import { expensePayloadSchema, type ExpensePayload } from "@/lib/expense-payload";

interface ExpenseResult {
  ok?: boolean;
  error?: string;
}

function splitParticipants(split: SplitInput): string[] {
  switch (split.method) {
    case "even":
      return split.participants;
    case "exact":
    case "shares":
    case "percent":
      return split.allocations.map((a) => a.userId);
    case "itemized":
      return [...new Set(split.items.flatMap((i) => i.consumers.map((c) => c.userId)))];
    case "adjustment":
      return [split.owerId];
  }
}

/** Validate payload against group membership + money invariants, compute shares. */
function prepare(groupId: string, payload: ExpensePayload) {
  const memberIds = new Set(getGroupMembers(groupId).map((m) => m.id));
  const everyone = [
    ...payload.payers.map((p) => p.userId),
    ...splitParticipants(payload.split),
  ];
  for (const uid of everyone) {
    if (!memberIds.has(uid)) throw new SplitError("Participant is not a group member");
  }
  const paidSum = payload.payers.reduce((s, p) => s + p.amountCents, 0);
  if (paidSum !== payload.totalCents) {
    throw new SplitError("Payer amounts must sum to the expense total");
  }
  const payerIds = new Set(payload.payers.map((p) => p.userId));
  if (payerIds.size !== payload.payers.length) {
    throw new SplitError("Duplicate payer");
  }
  // The frozen math: shares are computed once, here, and stored.
  const shares = computeShares(payload.totalCents, payload.split);
  return shares;
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

function insertExpenseRows(
  tx: Tx,
  args: {
    groupId: string;
    currency: string;
    createdBy: string;
    payload: ExpensePayload;
    shares: Map<string, number>;
    supersedesId?: string;
  },
) {
  const { groupId, currency, createdBy, payload, shares, supersedesId } = args;
  const expense = tx
    .insert(tables.expenses)
    .values({
      groupId,
      description: payload.description,
      totalCents: payload.totalCents,
      currency,
      paidAt: new Date(`${payload.paidAt}T00:00:00`),
      createdBy,
      splitMethod: payload.split.method,
      status: "active",
      supersedesId: supersedesId ?? null,
      splitInput: payload.split,
      notes: payload.notes || null,
    })
    .returning({ id: tables.expenses.id })
    .get();

  tx.insert(tables.expensePayers)
    .values(
      payload.payers.map((p) => ({
        expenseId: expense.id,
        userId: p.userId,
        amountCents: p.amountCents,
      })),
    )
    .run();

  tx.insert(tables.expenseShares)
    .values(
      [...shares.entries()].map(([userId, amountCents]) => ({
        expenseId: expense.id,
        userId,
        amountCents,
      })),
    )
    .run();

  if (payload.split.method === "itemized") {
    for (const item of payload.split.items) {
      const row = tx
        .insert(tables.expenseItems)
        .values({
          expenseId: expense.id,
          label: item.label,
          amountCents: item.amountCents,
          kind: "item",
        })
        .returning({ id: tables.expenseItems.id })
        .get();
      tx.insert(tables.expenseItemConsumers)
        .values(
          item.consumers.map((c) => ({
            itemId: row.id,
            userId: c.userId,
            weight: c.weight,
          })),
        )
        .run();
    }
    for (const o of payload.split.overheads) {
      tx.insert(tables.expenseItems)
        .values({
          expenseId: expense.id,
          label: o.label,
          amountCents: o.amountCents,
          kind: o.kind,
        })
        .run();
    }
  }

  return expense.id;
}

export async function createExpense(
  groupId: string,
  rawPayload: unknown,
): Promise<ExpenseResult> {
  const group = getGroup(groupId);
  if (!group) return { error: "Group not found" };

  const parsed = expensePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const shares = prepare(groupId, parsed.data);
    // No accounts: the first payer stands in as creator/actor.
    const actorId = parsed.data.payers[0].userId;
    db.transaction((tx) => {
      const expenseId = insertExpenseRows(tx, {
        groupId,
        currency: group.currency,
        createdBy: actorId,
        payload: parsed.data,
        shares,
      });
      // Activity in the SAME transaction — never as a post-commit side effect.
      tx.insert(tables.activityLog)
        .values({
          groupId,
          actorId,
          verb: "expense.created",
          payload: {
            expenseId,
            description: parsed.data.description,
            totalCents: parsed.data.totalCents,
            method: parsed.data.split.method,
          },
        })
        .run();
    });
  } catch (e) {
    if (e instanceof SplitError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/groups/${groupId}`);
  return { ok: true };
}

/**
 * Editing = supersede, never mutate. The old row flips to 'superseded' and a
 * new row points back at it via supersedes_id. If someone else edited first,
 * the guarded UPDATE matches 0 rows and we return a conflict error.
 */
export async function updateExpense(
  expenseId: string,
  rawPayload: unknown,
): Promise<ExpenseResult> {
  const old = getExpense(expenseId);
  if (!old) return { error: "Expense not found" };

  const parsed = expensePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const shares = prepare(old.groupId, parsed.data);
    const actorId = parsed.data.payers[0].userId;
    db.transaction((tx) => {
      const flipped = tx
        .update(tables.expenses)
        .set({ status: "superseded" })
        .where(
          and(eq(tables.expenses.id, expenseId), eq(tables.expenses.status, "active")),
        )
        .run();
      if (flipped.changes !== 1) {
        // Concurrent edit: someone superseded (or deleted) this row first.
        throw new SplitError(
          "This expense was changed by someone else — reload and try again",
        );
      }
      const newId = insertExpenseRows(tx, {
        groupId: old.groupId,
        currency: old.currency,
        createdBy: actorId,
        payload: parsed.data,
        shares,
        supersedesId: expenseId,
      });
      tx.insert(tables.activityLog)
        .values({
          groupId: old.groupId,
          actorId,
          verb: "expense.edited",
          payload: {
            expenseId: newId,
            description: parsed.data.description,
            totalCents: parsed.data.totalCents,
            previousTotalCents: old.totalCents,
          },
        })
        .run();
    });
  } catch (e) {
    if (e instanceof SplitError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/groups/${old.groupId}`);
  return { ok: true };
}

/** Deleting = status flip + audit entry. The ledger keeps the history. */
export async function deleteExpense(expenseId: string): Promise<ExpenseResult> {
  const old = getExpense(expenseId);
  if (!old) return { error: "Expense not found" };

  const flipped = db.transaction((tx) => {
    const result = tx
      .update(tables.expenses)
      .set({ status: "deleted" })
      .where(
        and(eq(tables.expenses.id, expenseId), eq(tables.expenses.status, "active")),
      )
      .run();
    if (result.changes !== 1) return false;
    tx.insert(tables.activityLog)
      .values({
        groupId: old.groupId,
        actorId: old.createdBy,
        verb: "expense.deleted",
        payload: { description: old.description, totalCents: old.totalCents },
      })
      .run();
    return true;
  });

  if (!flipped) return { error: "Expense was already changed — reload" };
  revalidatePath(`/groups/${old.groupId}`);
  return { ok: true };
}
