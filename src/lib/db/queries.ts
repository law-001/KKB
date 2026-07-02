import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, tables } from "@/lib/db";
import { assertZeroSum } from "@/lib/ledger/balances";

/** The app is open: everyone sees every group. */
export function getAllGroups() {
  return db
    .select({
      id: tables.groups.id,
      name: tables.groups.name,
      currency: tables.groups.currency,
      createdAt: tables.groups.createdAt,
    })
    .from(tables.groups)
    .orderBy(desc(tables.groups.createdAt))
    .all();
}

export function getGroup(groupId: string) {
  return db.select().from(tables.groups).where(eq(tables.groups.id, groupId)).get();
}

export interface Member {
  id: string;
  name: string;
  email: string | null; // legacy from the accounts era; always null now
  role: "admin" | "member";
}

export function getGroupMembers(groupId: string): Member[] {
  return db
    .select({
      id: tables.users.id,
      name: tables.users.name,
      email: tables.users.email,
      role: tables.groupMembers.role,
    })
    .from(tables.groupMembers)
    .innerJoin(tables.users, eq(tables.users.id, tables.groupMembers.userId))
    .where(eq(tables.groupMembers.groupId, groupId))
    .all();
}

export function isMember(groupId: string, userId: string): boolean {
  const row = db
    .select({ userId: tables.groupMembers.userId })
    .from(tables.groupMembers)
    .where(
      and(
        eq(tables.groupMembers.groupId, groupId),
        eq(tables.groupMembers.userId, userId),
      ),
    )
    .get();
  return row !== undefined;
}

/**
 * The derived balance — the plan's §4 query, verbatim in spirit:
 * paid (+) − consumed (−) − settlements sent (+) + received (−),
 * summed over the append-only ledger. Never stored anywhere.
 */
export function getGroupBalances(groupId: string): Map<string, number> {
  const rows = db.all<{ user_id: string; balance_cents: number }>(sql`
    SELECT user_id, SUM(delta) AS balance_cents FROM (
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
  // Every member appears, even with no activity yet.
  for (const m of getGroupMembers(groupId)) balances.set(m.id, 0);
  for (const r of rows) balances.set(r.user_id, r.balance_cents);
  assertZeroSum(balances); // runtime invariant — catches any rounding bug
  return balances;
}

/** Active expenses with payers and shares, for pairwise-exact debts. */
export function getLedgerForPairwise(groupId: string) {
  const activeExpenses = db
    .select({ id: tables.expenses.id })
    .from(tables.expenses)
    .where(
      and(
        eq(tables.expenses.groupId, groupId),
        eq(tables.expenses.status, "active"),
      ),
    )
    .all();
  const ids = activeExpenses.map((e) => e.id);
  const payers = ids.length
    ? db
        .select()
        .from(tables.expensePayers)
        .where(inArray(tables.expensePayers.expenseId, ids))
        .all()
    : [];
  const shares = ids.length
    ? db
        .select()
        .from(tables.expenseShares)
        .where(inArray(tables.expenseShares.expenseId, ids))
        .all()
    : [];

  const byExpense = new Map(
    ids.map((eid) => [
      eid,
      { payers: [] as typeof payers, shares: [] as typeof shares },
    ]),
  );
  for (const p of payers) byExpense.get(p.expenseId)!.payers.push(p);
  for (const s of shares) byExpense.get(s.expenseId)!.shares.push(s);

  const confirmedSettlements = db
    .select()
    .from(tables.settlements)
    .where(
      and(
        eq(tables.settlements.groupId, groupId),
        eq(tables.settlements.status, "confirmed"),
      ),
    )
    .all();

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
    .orderBy(desc(tables.expenses.paidAt))
    .all();
}

export function getExpense(expenseId: string) {
  return db
    .select()
    .from(tables.expenses)
    .where(eq(tables.expenses.id, expenseId))
    .get();
}

export function getExpenseDetail(expenseId: string) {
  const expense = getExpense(expenseId);
  if (!expense) return null;
  const payers = db
    .select({
      userId: tables.expensePayers.userId,
      amountCents: tables.expensePayers.amountCents,
      name: tables.users.name,
    })
    .from(tables.expensePayers)
    .innerJoin(tables.users, eq(tables.users.id, tables.expensePayers.userId))
    .where(eq(tables.expensePayers.expenseId, expenseId))
    .all();
  const shares = db
    .select({
      userId: tables.expenseShares.userId,
      amountCents: tables.expenseShares.amountCents,
      name: tables.users.name,
    })
    .from(tables.expenseShares)
    .innerJoin(tables.users, eq(tables.users.id, tables.expenseShares.userId))
    .where(eq(tables.expenseShares.expenseId, expenseId))
    .all();
  const items = db
    .select()
    .from(tables.expenseItems)
    .where(eq(tables.expenseItems.expenseId, expenseId))
    .all();
  return { expense, payers, shares, items };
}

/** Walk the supersedes chain backwards (edit history, newest first). */
export function getExpenseHistory(expenseId: string) {
  const chain = [];
  let current = getExpense(expenseId);
  while (current) {
    chain.push(current);
    current = current.supersedesId ? getExpense(current.supersedesId) : undefined;
  }
  return chain;
}

export function getGroupSettlements(groupId: string) {
  return db
    .select()
    .from(tables.settlements)
    .where(eq(tables.settlements.groupId, groupId))
    .orderBy(desc(tables.settlements.createdAt))
    .all();
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
    .limit(limit)
    .all();
}
