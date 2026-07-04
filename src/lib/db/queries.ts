import "server-only";
import { cache } from "react";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/lib/db";
import { assertZeroSum } from "@/lib/ledger/balances";

/** Only groups the given user is a member of. */
export async function getGroupsForUser(userId: string) {
  return db
    .select({
      id: tables.groups.id,
      name: tables.groups.name,
      currency: tables.groups.currency,
      createdAt: tables.groups.createdAt,
    })
    .from(tables.groupMembers)
    .innerJoin(tables.groups, eq(tables.groups.id, tables.groupMembers.groupId))
    .where(eq(tables.groupMembers.userId, userId))
    .orderBy(desc(tables.groups.createdAt));
}

// The DB is a ~90ms network roundtrip away, so hot per-request reads are
// wrapped in React cache() — layout, page, and actions in the same request
// share one query instead of each paying the roundtrip again.
export const getGroup = cache(async (groupId: string) => {
  const [row] = await db.select().from(tables.groups).where(eq(tables.groups.id, groupId));
  return row;
});

export async function getGroupByInviteCode(code: string) {
  const [row] = await db
    .select()
    .from(tables.groups)
    .where(eq(tables.groups.inviteCode, code));
  return row;
}

export interface Member {
  id: string;
  name: string;
  // NULL = ghost member — added by name, no account.
  email: string | null;
  role: "admin" | "member";
}

export const getGroupMembers = cache((groupId: string): Promise<Member[]> => {
  return db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      role: tables.groupMembers.role,
    })
    .from(tables.groupMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.groupMembers.userId))
    .where(eq(tables.groupMembers.groupId, groupId));
});

export async function isMember(groupId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: tables.groupMembers.userId })
    .from(tables.groupMembers)
    .where(
      and(
        eq(tables.groupMembers.groupId, groupId),
        eq(tables.groupMembers.userId, userId),
      ),
    );
  return row !== undefined;
}

export async function getMemberRole(
  groupId: string,
  userId: string,
): Promise<"admin" | "member" | undefined> {
  const [row] = await db
    .select({ role: tables.groupMembers.role })
    .from(tables.groupMembers)
    .where(
      and(
        eq(tables.groupMembers.groupId, groupId),
        eq(tables.groupMembers.userId, userId),
      ),
    );
  return row?.role;
}

/**
 * The derived balance — the plan's §4 query, verbatim in spirit:
 * paid (+) − consumed (−) − settlements sent (+) + received (−),
 * summed over the append-only ledger. Never stored anywhere.
 */
export async function getGroupBalances(groupId: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ user_id: string; balance_cents: number }>(sql`
    SELECT user_id, SUM(delta)::int AS balance_cents FROM (
      -- Zero-seed so every member appears even with no activity yet
      -- (saves a separate members roundtrip).
      SELECT gm.user_id AS user_id, 0 AS delta
        FROM group_members gm
       WHERE gm.group_id = ${groupId}
      UNION ALL
      SELECT ep.user_id AS user_id, ep.amount_cents AS delta
        FROM expense_payers ep
        JOIN expenses e ON e.id = ep.expense_id
       WHERE e.group_id = ${groupId} AND e.status = 'active'
      UNION ALL
      SELECT es.user_id, -es.amount_cents
        FROM expense_shares es
        JOIN expenses e ON e.id = es.expense_id
       WHERE e.group_id = ${groupId} AND e.status = 'active'
      UNION ALL
      SELECT s.from_user, s.amount_cents
        FROM settlements s
       WHERE s.group_id = ${groupId} AND s.status = 'confirmed'
      UNION ALL
      SELECT s.to_user, -s.amount_cents
        FROM settlements s
       WHERE s.group_id = ${groupId} AND s.status = 'confirmed'
    ) ledger
    GROUP BY user_id
  `);

  const balances = new Map<string, number>();
  for (const r of rows) balances.set(r.user_id, r.balance_cents);
  assertZeroSum(balances); // runtime invariant — catches any rounding bug
  return balances;
}

/** Active expenses with payers and shares, for pairwise-exact debts. */
export async function getLedgerForPairwise(groupId: string) {
  const [activeExpenses, confirmedSettlements] = await Promise.all([
    db
      .select({ id: tables.expenses.id })
      .from(tables.expenses)
      .where(
        and(
          eq(tables.expenses.groupId, groupId),
          eq(tables.expenses.status, "active"),
        ),
      ),
    db
      .select()
      .from(tables.settlements)
      .where(
        and(
          eq(tables.settlements.groupId, groupId),
          eq(tables.settlements.status, "confirmed"),
        ),
      ),
  ]);
  const ids = activeExpenses.map((e) => e.id);
  const [payers, shares] = ids.length
    ? await Promise.all([
        db
          .select()
          .from(tables.expensePayers)
          .where(inArray(tables.expensePayers.expenseId, ids)),
        db
          .select()
          .from(tables.expenseShares)
          .where(inArray(tables.expenseShares.expenseId, ids)),
      ])
    : [[], []];

  const byExpense = new Map(
    ids.map((eid) => [
      eid,
      { payers: [] as typeof payers, shares: [] as typeof shares },
    ]),
  );
  for (const p of payers) byExpense.get(p.expenseId)!.payers.push(p);
  for (const s of shares) byExpense.get(s.expenseId)!.shares.push(s);

  return {
    expenses: [...byExpense.values()].map((e) => ({
      payers: e.payers.map((p) => ({ userId: p.userId, amountCents: p.amountCents })),
      shares: e.shares.map((s) => ({ userId: s.userId, amountCents: s.amountCents })),
    })),
    settlements: confirmedSettlements.map((s) => ({
      fromUser: s.fromUser,
      toUser: s.toUser,
      amountCents: s.amountCents,
    })),
  };
}

export function getGroupExpenses(groupId: string) {
  return db
    .select()
    .from(tables.expenses)
    .where(
      and(
        eq(tables.expenses.groupId, groupId),
        eq(tables.expenses.status, "active"),
      ),
    )
    .orderBy(desc(tables.expenses.paidAt));
}

export async function getExpense(expenseId: string) {
  const rows = await db
    .select()
    .from(tables.expenses)
    .where(eq(tables.expenses.id, expenseId));
  return rows.at(0);
}

export async function getExpenseDetail(expenseId: string) {
  // Four independent lookups — one roundtrip of latency instead of four.
  const [expense, payers, shares, items] = await Promise.all([
    getExpense(expenseId),
    db
      .select({
        userId: tables.expensePayers.userId,
        amountCents: tables.expensePayers.amountCents,
        name: tables.users.name,
      })
      .from(tables.expensePayers)
      .innerJoin(tables.users, eq(tables.users.id, tables.expensePayers.userId))
      .where(eq(tables.expensePayers.expenseId, expenseId)),
    db
      .select({
        userId: tables.expenseShares.userId,
        amountCents: tables.expenseShares.amountCents,
        name: tables.users.name,
      })
      .from(tables.expenseShares)
      .innerJoin(tables.users, eq(tables.users.id, tables.expenseShares.userId))
      .where(eq(tables.expenseShares.expenseId, expenseId)),
    db
      .select()
      .from(tables.expenseItems)
      .where(eq(tables.expenseItems.expenseId, expenseId)),
  ]);
  if (!expense) return null;
  return { expense, payers, shares, items };
}

/**
 * Walk the supersedes chain backwards (edit history, newest first) — a
 * single recursive query rather than one roundtrip per edit.
 */
export async function getExpenseHistory(expenseId: string) {
  const rows = await db.execute<{
    id: string;
    description: string;
    total_cents: number;
    currency: string;
    created_at: string | Date;
  }>(sql`
    WITH RECURSIVE chain AS (
      SELECT e.*, 0 AS depth FROM expenses e WHERE e.id = ${expenseId}
      UNION ALL
      SELECT e.*, c.depth + 1 FROM expenses e JOIN chain c ON e.id = c.supersedes_id
    )
    SELECT id, description, total_cents, currency, created_at
      FROM chain ORDER BY depth
  `);
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    totalCents: r.total_cents,
    currency: r.currency,
    createdAt: new Date(r.created_at),
  }));
}

/**
 * A member's slice of every active expense (their paid vs. share amounts),
 * in one roundtrip — the member-tab page used to do 4 queries per expense.
 */
export async function getMemberExpenseRows(groupId: string, memberId: string) {
  const rows = await db.execute<{
    id: string;
    description: string;
    currency: string;
    paid_at: string | Date;
    paid_cents: number;
    share_cents: number;
  }>(sql`
    SELECT e.id, e.description, e.currency, e.paid_at,
           COALESCE(p.amount_cents, 0)::int AS paid_cents,
           COALESCE(s.amount_cents, 0)::int AS share_cents
      FROM expenses e
      LEFT JOIN expense_payers p
        ON p.expense_id = e.id AND p.user_id = ${memberId}
      LEFT JOIN expense_shares s
        ON s.expense_id = e.id AND s.user_id = ${memberId}
     WHERE e.group_id = ${groupId}
       AND e.status = 'active'
       AND (p.user_id IS NOT NULL OR s.user_id IS NOT NULL)
  `);
  return rows.map((r) => ({
    id: r.id,
    description: r.description,
    currency: r.currency,
    paidAt: new Date(r.paid_at),
    paidCents: r.paid_cents,
    shareCents: r.share_cents,
  }));
}

/**
 * Confirmed settlements linked to specific expenses (table-side bayad/sukli).
 * Pass the whole supersedes chain so payments survive expense edits.
 */
export async function getExpensePayments(expenseIds: string[]) {
  if (expenseIds.length === 0) return [];
  return db
    .select()
    .from(tables.settlements)
    .where(
      and(
        inArray(tables.settlements.expenseId, expenseIds),
        eq(tables.settlements.status, "confirmed"),
      ),
    );
}

export function getGroupSettlements(groupId: string) {
  return db
    .select()
    .from(tables.settlements)
    .where(eq(tables.settlements.groupId, groupId))
    .orderBy(desc(tables.settlements.createdAt));
}

export function getActivityFeed(groupId: string, limit = 50) {
  return db
    .select({
      id: tables.activityLog.id,
      verb: tables.activityLog.verb,
      payload: tables.activityLog.payload,
      createdAt: tables.activityLog.createdAt,
      actorName: tables.users.name,
    })
    .from(tables.activityLog)
    .innerJoin(tables.users, eq(tables.users.id, tables.activityLog.actorId))
    .where(eq(tables.activityLog.groupId, groupId))
    .orderBy(desc(tables.activityLog.createdAt))
    .limit(limit);
}
