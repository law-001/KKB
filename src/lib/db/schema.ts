/**
 * Drizzle schema — mirror of build plan §2.
 *
 * Core design decision: the ledger is APPEND-ONLY. Balances are never stored;
 * they're derived by summing expense_payers / expense_shares / settlements.
 * Editing an expense inserts a new row (supersedes_id chain); deleting flips
 * status. All money columns are integer minor units (cents). Never floats.
 */
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { nanoid } from "nanoid";
import type { SplitInput } from "@/lib/ledger/split";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => nanoid(12));

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date());

export const users = sqliteTable("users", {
  id: id(),
  name: text("name").notNull(),
  // NULL email = "ghost" member added by name only (no account yet).
  email: text("email").unique(),
  passwordHash: text("password_hash"),
  // Set when a real account claims a ghost's ledger history (Phase 3).
  claimedBy: text("claimed_by"),
  createdAt: createdAt(),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: createdAt(),
});

export const groups = sqliteTable("groups", {
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

export const groupMembers = sqliteTable(
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
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

export const expenses = sqliteTable(
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
    paidAt: integer("paid_at", { mode: "timestamp_ms" }).notNull(),
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
    splitInput: text("split_input", { mode: "json" }).$type<SplitInput>(),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("expenses_group_status_idx").on(t.groupId, t.status)],
);

/** Supports "we put it on two cards" — how much each payer actually paid. */
export const expensePayers = sqliteTable(
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
export const expenseShares = sqliteTable(
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
export const expenseItems = sqliteTable("expense_items", {
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

export const expenseItemConsumers = sqliteTable(
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

export const settlements = sqliteTable(
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
    settledAt: integer("settled_at", { mode: "timestamp_ms" }).notNull(),
    // Only 'confirmed' rows count toward balances — the recipient confirms.
    status: text("status", { enum: ["pending", "confirmed", "rejected"] })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("settlements_group_status_idx").on(t.groupId, t.status)],
);

export const activityLog = sqliteTable(
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
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_group_idx").on(t.groupId, t.createdAt)],
);
