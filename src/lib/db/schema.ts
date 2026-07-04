/**
 * Drizzle schema — mirror of build plan §2.
 *
 * Core design decision: the ledger is APPEND-ONLY. Balances are never stored;
 * they're derived by summing expense_payers / expense_shares / settlements.
 * Editing an expense inserts a new row (supersedes_id chain); deleting flips
 * status. All money columns are integer minor units (cents). Never floats.
 *
 * Identity: users.id is the Supabase Auth user id (uuid, stored as text) for
 * real accounts, set explicitly on first login — or an app-generated id for
 * a ghost member (added by name, no login). NULL email = ghost. Supabase
 * Auth owns passwords/sessions for real accounts; this table only holds
 * app-facing profile data.
 */
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import type { SplitInput } from "@/lib/ledger/split";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => nanoid(12));

const createdAt = () =>
  timestamp("created_at", { withTimezone: true })
    .notNull()
    .$defaultFn(() => new Date());

export const users = pgTable("users", {
  // Supabase Auth user id (uuid) for real accounts, supplied on first login;
  // an app-generated nanoid for ghost members.
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  // NULL = ghost member (no Supabase Auth account backing this row).
  email: text("email").unique(),
  createdAt: createdAt(),
});

export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  currency: text("currency").notNull(), // ISO 4217, e.g. "PHP"
  createdBy: text("created_by")
    .notNull()
    .references(() => users.id),
  inviteCode: text("invite_code")
    .notNull()
    .unique()
    .$defaultFn(() => nanoid(10)),
  createdAt: createdAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ["admin", "member"] })
      .notNull()
      .default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    description: text("description").notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    // When the money was spent — user-editable, distinct from createdAt.
    // Backdating "just works" because balance math never looks at dates.
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    splitMethod: text("split_method", {
      enum: ["even", "exact", "shares", "percent", "itemized", "adjustment"],
    }).notNull(),
    status: text("status", { enum: ["active", "superseded", "deleted"] })
      .notNull()
      .default("active"),
    // Edit-history chain: an edit inserts a NEW row pointing at the old one.
    supersedesId: text("supersedes_id"),
    // The raw split input, kept so edits can re-open the form pre-filled.
    // The ledger truth is expense_shares (frozen output), never this.
    splitInput: jsonb("split_input").$type<SplitInput>(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_group_status_idx").on(t.groupId, t.status)],
);

/** Supports "we put it on two cards" — how much each payer actually paid. */
export const expensePayers = pgTable(
  "expense_payers",
  {
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);

/**
 * Who consumed what — the OUTPUT of the split calculation, frozen at write
 * time. INVARIANT: SUM(amount_cents) per expense == expenses.total_cents,
 * and likewise for expense_payers. Enforced in the write transaction.
 */
export const expenseShares = pgTable(
  "expense_shares",
  {
    expenseId: text("expense_id")
      .notNull()
      .references(() => expenses.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.userId] })],
);

/** Only for itemized splits — items are input detail, shares are ledger truth. */
export const expenseItems = pgTable("expense_items", {
  id: id(),
  expenseId: text("expense_id")
    .notNull()
    .references(() => expenses.id),
  label: text("label").notNull(),
  amountCents: integer("amount_cents").notNull(),
  kind: text("kind", {
    enum: ["item", "tax", "tip", "service", "discount"],
  })
    .notNull()
    .default("item"),
});

export const expenseItemConsumers = pgTable(
  "expense_item_consumers",
  {
    itemId: text("item_id")
      .notNull()
      .references(() => expenseItems.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    // "We shared the fries but I ate more" — 2:1.
    weight: integer("weight").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.userId] })],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    fromUser: text("from_user")
      .notNull()
      .references(() => users.id),
    toUser: text("to_user")
      .notNull()
      .references(() => users.id),
    amountCents: integer("amount_cents").notNull(),
    method: text("method"), // "GCash", "cash", ...
    // Set when this settlement is table-side cash (bayad/sukli) for one
    // specific expense; NULL for free-standing settle-up payments.
    expenseId: text("expense_id").references(() => expenses.id),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
    // Only 'confirmed' rows count toward balances — the recipient confirms.
    status: text("status", { enum: ["pending", "confirmed", "rejected"] })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("settlements_group_status_idx").on(t.groupId, t.status)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: id(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    verb: text("verb").notNull(), // 'expense.created', 'settlement.confirmed', ...
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_group_idx").on(t.groupId, t.createdAt)],
);
