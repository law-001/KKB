/**
 * Demo/dev seed: wipes the database and rebuilds it with a realistic group —
 * every split method, a ghost member, a backdated expense, settlements in all
 * three states — then verifies the zero-sum invariant against the same SQL
 * aggregate the app uses.
 *
 * Run: npm run db:seed
 * Sign in afterwards as alex@example.com / password123 (or mia@/sam@ same pw).
 */
import { randomBytes, scryptSync } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, tables } from "../src/lib/db";
import { computeShares, type SplitInput } from "../src/lib/ledger/split";
import { computeBalances, assertZeroSum } from "../src/lib/ledger/balances";
import { simplifyDebts } from "../src/lib/ledger/simplify";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

// ── Wipe (children before parents) ─────────────────────────────────────────
for (const table of [
  "expense_item_consumers",
  "expense_items",
  "expense_shares",
  "expense_payers",
  "expenses",
  "settlements",
  "activity_log",
  "group_members",
  "groups",
  "sessions",
  "users",
]) {
  db.run(sql.raw(`DELETE FROM ${table}`));
}

// ── Users ───────────────────────────────────────────────────────────────────
const password = hashPassword("password123");
const [alex, mia, sam] = db
  .insert(tables.users)
  .values([
    { name: "Alex", email: "alex@example.com", passwordHash: password },
    { name: "Mia", email: "mia@example.com", passwordHash: password },
    { name: "Sam", email: "sam@example.com", passwordHash: password },
  ])
  .returning()
  .all();
const ghost = db
  .insert(tables.users)
  .values({ name: "Gab (ghost)", email: null, passwordHash: null })
  .returning()
  .get();

// Fixed session token so scripted HTTP checks can authenticate as Alex.
db.insert(tables.sessions)
  .values({
    token: "seed-alex-session-token",
    userId: alex.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  })
  .run();

// ── Group ───────────────────────────────────────────────────────────────────
const group = db
  .insert(tables.groups)
  .values({
    name: "Friday Dinner Crew",
    currency: "PHP",
    createdBy: alex.id,
    inviteCode: "demo-invite",
  })
  .returning()
  .get();
db.insert(tables.groupMembers)
  .values([
    { groupId: group.id, userId: alex.id, role: "admin" },
    { groupId: group.id, userId: mia.id, role: "member" },
    { groupId: group.id, userId: sam.id, role: "member" },
    { groupId: group.id, userId: ghost.id, role: "member" },
  ])
  .run();

// ── Expense helper: same shape of writes the server action performs ────────
function addExpense(args: {
  description: string;
  totalCents: number;
  paidAt: Date;
  payers: { userId: string; amountCents: number }[];
  split: SplitInput;
  notes?: string;
}) {
  const shares = computeShares(args.totalCents, args.split);
  const paidSum = args.payers.reduce((s, p) => s + p.amountCents, 0);
  if (paidSum !== args.totalCents) throw new Error("payers must sum to total");

  db.transaction((tx) => {
    const expense = tx
      .insert(tables.expenses)
      .values({
        groupId: group.id,
        description: args.description,
        totalCents: args.totalCents,
        currency: "PHP",
        paidAt: args.paidAt,
        createdBy: args.payers[0].userId,
        splitMethod: args.split.method,
        splitInput: args.split,
        notes: args.notes ?? null,
      })
      .returning({ id: tables.expenses.id })
      .get();
    tx.insert(tables.expensePayers)
      .values(args.payers.map((p) => ({ expenseId: expense.id, ...p })))
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
    if (args.split.method === "itemized") {
      for (const item of args.split.items) {
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
          .values(item.consumers.map((c) => ({ itemId: row.id, userId: c.userId, weight: c.weight })))
          .run();
      }
      for (const o of args.split.overheads) {
        tx.insert(tables.expenseItems)
          .values({ expenseId: expense.id, label: o.label, amountCents: o.amountCents, kind: o.kind })
          .run();
      }
    }
    tx.insert(tables.activityLog)
      .values({
        groupId: group.id,
        actorId: args.payers[0].userId,
        verb: "expense.created",
        payload: {
          expenseId: expense.id,
          description: args.description,
          totalCents: args.totalCents,
          method: args.split.method,
        },
      })
      .run();
  });
}

// 1. Even: ₱1,200 dinner / 4 people, paid by Alex, 5 days ago.
addExpense({
  description: "Dinner at Manam",
  totalCents: 120000,
  paidAt: daysAgo(5),
  payers: [{ userId: alex.id, amountCents: 120000 }],
  split: { method: "even", participants: [alex.id, mia.id, sam.id, ghost.id] },
});

// 2. Itemized: "I only had a salad" — proportional service charge.
addExpense({
  description: "Lunch at Wildflour",
  totalCents: 137500,
  paidAt: daysAgo(3),
  payers: [{ userId: mia.id, amountCents: 137500 }],
  split: {
    method: "itemized",
    items: [
      { label: "Caesar salad", amountCents: 25000, consumers: [{ userId: sam.id, weight: 1 }] },
      { label: "Steak frites", amountCents: 65000, consumers: [{ userId: alex.id, weight: 1 }] },
      {
        label: "Truffle fries (shared, Alex ate more)",
        amountCents: 22500,
        consumers: [
          { userId: alex.id, weight: 2 },
          { userId: mia.id, weight: 1 },
        ],
      },
      { label: "Iced tea", amountCents: 12500, consumers: [{ userId: mia.id, weight: 1 }] },
    ],
    overheads: [
      { kind: "service", label: "Service charge 10%", amountCents: 12500, distribution: "proportional" },
    ],
  },
  notes: "Sam only had the salad — proportional service charge, as it should be.",
});

// 3. Shares: groceries for the beach trip, couple counts double.
addExpense({
  description: "Beach trip groceries",
  totalCents: 84000,
  paidAt: daysAgo(2),
  payers: [{ userId: sam.id, amountCents: 84000 }],
  split: {
    method: "shares",
    allocations: [
      { userId: alex.id, shares: 2 },
      { userId: mia.id, shares: 1 },
      { userId: sam.id, shares: 1 },
    ],
  },
});

// 4. Percent, multiple payers ("we put it on two cards").
addExpense({
  description: "Karaoke room",
  totalCents: 60000,
  paidAt: daysAgo(1),
  payers: [
    { userId: alex.id, amountCents: 40000 },
    { userId: mia.id, amountCents: 20000 },
  ],
  split: {
    method: "percent",
    allocations: [
      { userId: alex.id, basisPoints: 5000 },
      { userId: mia.id, basisPoints: 3000 },
      { userId: sam.id, basisPoints: 2000 },
    ],
  },
});

// 5. Backdated IOU from three weeks ago — "you owe me from three dinners ago".
addExpense({
  description: "Spotted you at the arcade",
  totalCents: 20000,
  paidAt: daysAgo(21),
  payers: [{ userId: alex.id, amountCents: 20000 }],
  split: { method: "adjustment", owerId: sam.id },
});

// ── Settlements: one confirmed, one pending, one rejected ──────────────────
db.insert(tables.settlements)
  .values([
    {
      groupId: group.id,
      fromUser: mia.id,
      toUser: alex.id,
      amountCents: 30000,
      method: "GCash",
      settledAt: daysAgo(1),
      status: "confirmed",
    },
    {
      groupId: group.id,
      fromUser: sam.id,
      toUser: alex.id,
      amountCents: 50000,
      method: "cash",
      settledAt: daysAgo(0),
      status: "pending",
    },
    {
      groupId: group.id,
      fromUser: sam.id,
      toUser: mia.id,
      amountCents: 10000,
      method: "cash",
      settledAt: daysAgo(2),
      status: "rejected",
    },
  ])
  .run();
db.insert(tables.activityLog)
  .values([
    {
      groupId: group.id,
      actorId: mia.id,
      verb: "settlement.confirmed",
      payload: { fromName: "Mia", toName: "Alex", amountCents: 30000, method: "GCash" },
    },
    {
      groupId: group.id,
      actorId: sam.id,
      verb: "settlement.recorded",
      payload: { fromName: "Sam", toName: "Alex", amountCents: 50000, method: "cash" },
    },
  ])
  .run();

// ── Verify: recompute balances via the same SQL aggregate the app uses ─────
const rows = db.all<{ user_id: string; balance_cents: number }>(sql`
  SELECT user_id, SUM(delta) AS balance_cents FROM (
    SELECT ep.user_id AS user_id, ep.amount_cents AS delta
      FROM expense_payers ep JOIN expenses e ON e.id = ep.expense_id
     WHERE e.group_id = ${group.id} AND e.status = 'active'
    UNION ALL
    SELECT es.user_id, -es.amount_cents
      FROM expense_shares es JOIN expenses e ON e.id = es.expense_id
     WHERE e.group_id = ${group.id} AND e.status = 'active'
    UNION ALL
    SELECT s.from_user, s.amount_cents FROM settlements s
     WHERE s.group_id = ${group.id} AND s.status = 'confirmed'
    UNION ALL
    SELECT s.to_user, -s.amount_cents FROM settlements s
     WHERE s.group_id = ${group.id} AND s.status = 'confirmed'
  ) ledger GROUP BY user_id
`);

const balances = computeBalances(
  rows.map((r) => ({ userId: r.user_id, deltaCents: r.balance_cents })),
);
assertZeroSum(balances);

const names = new Map([
  [alex.id, "Alex"],
  [mia.id, "Mia"],
  [sam.id, "Sam"],
  [ghost.id, "Gab (ghost)"],
]);
console.log("Seeded. Balances (centavos, + = group owes them):");
for (const [uid, cents] of balances) {
  console.log(`  ${names.get(uid)}: ${cents}`);
}
console.log("Zero-sum invariant: OK");
console.log("Suggested settle-up plan:");
for (const t of simplifyDebts(balances)) {
  console.log(`  ${names.get(t.from)} -> ${names.get(t.to)}: ${t.amountCents}`);
}
console.log(`\nGroup: http://localhost:3000/groups/${group.id}`);
console.log("Invite: http://localhost:3000/join/demo-invite");
console.log("Sign in: alex@example.com / password123 (also mia@, sam@)");
