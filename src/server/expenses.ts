"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, tables, type DB } from "@/lib/db";
import { getExpense, getGroup, getGroupMembers } from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
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
async function prepare(groupId: string, payload: ExpensePayload) {
  const members = await getGroupMembers(groupId);
  const memberIds = new Set(members.map((m) => m.id));
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
  for (const pay of payload.payments ?? []) {
    if (!memberIds.has(pay.userId))
      throw new SplitError("Participant is not a group member");
    if (payerIds.has(pay.userId))
      throw new SplitError("Someone who fronted the bill can't also hand cash over");
  }
  // The frozen math: shares are computed once, here, and stored.
  const shares = computeShares(payload.totalCents, payload.split);
  return { shares, members };
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

async function insertExpenseRows(
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
  const [expense] = await tx
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
    .returning({ id: tables.expenses.id });

  await tx.insert(tables.expensePayers).values(
    payload.payers.map((p) => ({
      expenseId: expense.id,
      userId: p.userId,
      amountCents: p.amountCents,
    })),
  );

  await tx.insert(tables.expenseShares).values(
    [...shares.entries()].map(([userId, amountCents]) => ({
      expenseId: expense.id,
      userId,
      amountCents,
    })),
  );

  if (payload.split.method === "itemized") {
    const { items, overheads } = payload.split;
    if (items.length > 0) {
      // One batched insert for all items (RETURNING preserves VALUES order),
      // then one for all consumers — not two roundtrips per receipt line.
      const itemRows = await tx
        .insert(tables.expenseItems)
        .values(
          items.map((item) => ({
            expenseId: expense.id,
            label: item.label,
            amountCents: item.amountCents,
            kind: "item" as const,
          })),
        )
        .returning({ id: tables.expenseItems.id });
      await tx.insert(tables.expenseItemConsumers).values(
        items.flatMap((item, i) =>
          item.consumers.map((c) => ({
            itemId: itemRows[i].id,
            userId: c.userId,
            weight: c.weight,
          })),
        ),
      );
    }
    if (overheads.length > 0) {
      await tx.insert(tables.expenseItems).values(
        overheads.map((o) => ({
          expenseId: expense.id,
          label: o.label,
          amountCents: o.amountCents,
          kind: o.kind,
        })),
      );
    }
  }

  return expense.id;
}

export async function createExpense(
  groupId: string,
  rawPayload: unknown,
): Promise<ExpenseResult> {
  const actor = await requireGroupMember(groupId);

  const parsed = expensePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const [group, { shares, members }] = await Promise.all([
      getGroup(groupId),
      prepare(groupId, parsed.data),
    ]);
    if (!group) return { error: "Group not found" };
    await db.transaction(async (tx) => {
      const expenseId = await insertExpenseRows(tx, {
        groupId,
        currency: group.currency,
        createdBy: actor.id,
        payload: parsed.data,
        shares,
      });
      // Activity in the SAME transaction — never as a post-commit side effect.
      await tx.insert(tables.activityLog).values({
        groupId,
        actorId: actor.id,
        verb: "expense.created",
        payload: {
          expenseId,
          description: parsed.data.description,
          totalCents: parsed.data.totalCents,
          method: parsed.data.split.method,
        },
      });

      // Table-side cash (bayad): settlements to the payer, linked to this
      // expense so the detail page can show who has paid up.
      const payments = parsed.data.payments ?? [];
      if (payments.length > 0) {
        const nameOf = (id: string) =>
          members.find((m) => m.id === id)?.name ?? "?";
        const payerId = parsed.data.payers[0].userId;
        // Batched: one insert for all settlements (RETURNING preserves
        // VALUES order), one for their activity entries.
        const settled = await tx
          .insert(tables.settlements)
          .values(
            payments.map((pay) => ({
              groupId,
              fromUser: pay.userId,
              toUser: payerId,
              amountCents: pay.amountCents,
              method: "cash",
              expenseId,
              settledAt: new Date(),
              status: "confirmed" as const,
            })),
          )
          .returning({ id: tables.settlements.id });
        await tx.insert(tables.activityLog).values(
          payments.map((pay, i) => ({
            groupId,
            actorId: pay.userId,
            verb: "settlement.confirmed",
            payload: {
              settlementId: settled[i].id,
              fromName: nameOf(pay.userId),
              toName: nameOf(payerId),
              amountCents: pay.amountCents,
              method: "cash",
            },
          })),
        );
      }
    });
  } catch (e) {
    if (e instanceof SplitError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/groups/${groupId}`, "layout");
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
  const old = await getExpense(expenseId);
  if (!old) return { error: "Expense not found" };
  const actor = await requireGroupMember(old.groupId);

  const parsed = expensePayloadSchema.safeParse(rawPayload);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  try {
    const { shares } = await prepare(old.groupId, parsed.data);
    await db.transaction(async (tx) => {
      const flipped = await tx
        .update(tables.expenses)
        .set({ status: "superseded" })
        .where(
          and(eq(tables.expenses.id, expenseId), eq(tables.expenses.status, "active")),
        );
      if (flipped.count !== 1) {
        // Concurrent edit: someone superseded (or deleted) this row first.
        throw new SplitError(
          "This expense was changed by someone else — reload and try again",
        );
      }
      const newId = await insertExpenseRows(tx, {
        groupId: old.groupId,
        currency: old.currency,
        createdBy: actor.id,
        payload: parsed.data,
        shares,
        supersedesId: expenseId,
      });
      await tx.insert(tables.activityLog).values({
        groupId: old.groupId,
        actorId: actor.id,
        verb: "expense.edited",
        payload: {
          expenseId: newId,
          description: parsed.data.description,
          totalCents: parsed.data.totalCents,
          previousTotalCents: old.totalCents,
        },
      });
    });
  } catch (e) {
    if (e instanceof SplitError) return { error: e.message };
    throw e;
  }

  revalidatePath(`/groups/${old.groupId}`, "layout");
  return { ok: true };
}

/** Deleting = status flip + audit entry. The ledger keeps the history. */
export async function deleteExpense(expenseId: string): Promise<ExpenseResult> {
  const old = await getExpense(expenseId);
  if (!old) return { error: "Expense not found" };
  const actor = await requireGroupMember(old.groupId);

  const flipped = await db.transaction(async (tx) => {
    const result = await tx
      .update(tables.expenses)
      .set({ status: "deleted" })
      .where(
        and(eq(tables.expenses.id, expenseId), eq(tables.expenses.status, "active")),
      );
    if (result.count !== 1) return false;
    await tx.insert(tables.activityLog).values({
      groupId: old.groupId,
      actorId: actor.id,
      verb: "expense.deleted",
      payload: { description: old.description, totalCents: old.totalCents },
    });
    return true;
  });

  if (!flipped) return { error: "Expense was already changed — reload" };
  revalidatePath(`/groups/${old.groupId}`, "layout");
  return { ok: true };
}
