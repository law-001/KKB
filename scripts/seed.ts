/**
 * Demo/dev seed: wipes the app tables and rebuilds them with a realistic
 * group — every split method, a backdated expense, settlements — then
 * verifies the zero-sum invariant against the same SQL aggregate the app
 * uses.
 *
 * Real accounts now back every member, so this also creates (or reuses)
 * Supabase Auth users via the admin API — needs SUPABASE_SERVICE_ROLE_KEY.
 * Sign in as any of them at /login with a magic link to the printed email.
 *
 * Run: npm run db:seed
 */
import { createClient } from "@supabase/supabase-js";
import { sql } from "drizzle-orm";
import { db, tables } from "../src/lib/db";
import { computeShares, type SplitInput } from "../src/lib/ledger/split";
import { computeBalances, assertZeroSum } from "../src/lib/ledger/balances";
import { simplifyDebts } from "../src/lib/ledger/simplify";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** Creates the Supabase Auth user if needed, reusing it across reseeds. */
async function ensureAuthUser(email: string): Promise<string> {
  const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (created.user) return created.user.id;

  if (error?.code !== "email_exists") throw error;
  const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers();
  if (listError) throw listError;
  const existing = list.users.find((u) => u.email === email);
  if (!existing) throw new Error(`Could not find existing auth user for ${email}`);
  return existing.id;
}

async function main() {
  // ── Wipe app tables (children before parents; Supabase Auth users persist) ─
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
    "users",
  ]) {
    await db.execute(sql.raw(`DELETE FROM ${table}`));
  }

  // ── Members — real Supabase Auth accounts, reused across reseeds ───────────
  const demo = [
    { name: "Alex", email: "alex@kkb.demo" },
    { name: "Mia", email: "mia@kkb.demo" },
    { name: "Sam", email: "sam@kkb.demo" },
    { name: "Gab", email: "gab@kkb.demo" },
  ];
  const [alex, mia, sam, gab] = await Promise.all(
    demo.map(async (d) => ({ id: await ensureAuthUser(d.email), ...d })),
  );
  await db
    .insert(tables.users)
    .values(demo.map((d, i) => ({ id: [alex, mia, sam, gab][i].id, name: d.name, email: d.email })));

  // ── Group ───────────────────────────────────────────────────────────────────
  const [group] = await db
    .insert(tables.groups)
    .values({
      name: "Friday Dinner Crew",
      currency: "PHP",
      createdBy: alex.id,
    })
    .returning();
  await db
    .insert(tables.groupMembers)
    .values([
      { groupId: group.id, userId: alex.id, role: "admin" },
      { groupId: group.id, userId: mia.id, role: "member" },
      { groupId: group.id, userId: sam.id, role: "member" },
      { groupId: group.id, userId: gab.id, role: "member" },
    ]);

  // ── Expense helper: same shape of writes the server action performs ────────
  async function addExpense(args: {
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

    await db.transaction(async (tx) => {
      const [expense] = await tx
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
        .returning({ id: tables.expenses.id });
      await tx
        .insert(tables.expensePayers)
        .values(args.payers.map((p) => ({ expenseId: expense.id, ...p })));
      await tx.insert(tables.expenseShares).values(
        [...shares.entries()].map(([userId, amountCents]) => ({
          expenseId: expense.id,
          userId,
          amountCents,
        })),
      );
      if (args.split.method === "itemized") {
        for (const item of args.split.items) {
          const [row] = await tx
            .insert(tables.expenseItems)
            .values({
              expenseId: expense.id,
              label: item.label,
              amountCents: item.amountCents,
              kind: "item",
            })
            .returning({ id: tables.expenseItems.id });
          await tx
            .insert(tables.expenseItemConsumers)
            .values(item.consumers.map((c) => ({ itemId: row.id, userId: c.userId, weight: c.weight })));
        }
        for (const o of args.split.overheads) {
          await tx
            .insert(tables.expenseItems)
            .values({ expenseId: expense.id, label: o.label, amountCents: o.amountCents, kind: o.kind });
        }
      }
      await tx.insert(tables.activityLog).values({
        groupId: group.id,
        actorId: args.payers[0].userId,
        verb: "expense.created",
        payload: {
          expenseId: expense.id,
          description: args.description,
          totalCents: args.totalCents,
          method: args.split.method,
        },
      });
    });
  }

  // 1. Even: ₱1,200 dinner / 4 people, paid by Alex, 5 days ago.
  await addExpense({
    description: "Dinner at Manam",
    totalCents: 120000,
    paidAt: daysAgo(5),
    payers: [{ userId: alex.id, amountCents: 120000 }],
    split: { method: "even", participants: [alex.id, mia.id, sam.id, gab.id] },
  });

  // 2. Itemized: "I only had a salad" — proportional service charge.
  await addExpense({
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
  await addExpense({
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
  await addExpense({
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
  await addExpense({
    description: "Spotted you at the arcade",
    totalCents: 20000,
    paidAt: daysAgo(21),
    payers: [{ userId: alex.id, amountCents: 20000 }],
    split: { method: "adjustment", owerId: sam.id },
  });

  // ── Settlements (recorded immediately — confirmation is the audit trail) ───
  await db
    .insert(tables.settlements)
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
        status: "confirmed",
      },
    ]);
  await db.insert(tables.activityLog).values([
    {
      groupId: group.id,
      actorId: mia.id,
      verb: "settlement.confirmed",
      payload: { fromName: "Mia", toName: "Alex", amountCents: 30000, method: "GCash" },
    },
    {
      groupId: group.id,
      actorId: sam.id,
      verb: "settlement.confirmed",
      payload: { fromName: "Sam", toName: "Alex", amountCents: 50000, method: "cash" },
    },
  ]);

  // ── Verify: recompute balances via the same SQL aggregate the app uses ─────
  const rows = await db.execute<{ user_id: string; balance_cents: number }>(sql`
    SELECT user_id, SUM(delta)::int AS balance_cents FROM (
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
    [gab.id, "Gab"],
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
  console.log("Sign in at /login with any of:", demo.map((d) => d.email).join(", "));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
