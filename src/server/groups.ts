"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import {
  getGroup,
  getGroupBalances,
  getGroupByInviteCode,
  getGroupMembers,
  getMemberRole,
} from "@/lib/db/queries";
import { requireUser } from "@/lib/auth";
import { SUPPORTED_CURRENCIES } from "@/lib/ledger/money";

export interface FormState {
  error?: string;
}

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(80),
  currency: z.string().refine((c) => SUPPORTED_CURRENCIES.includes(c), {
    message: "Unsupported currency",
  }),
});

export async function createGroup(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = createGroupSchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, currency } = parsed.data;

  const groupId = await db.transaction(async (tx) => {
    const [group] = await tx
      .insert(tables.groups)
      .values({ name, currency, createdBy: user.id })
      .returning({ id: tables.groups.id });
    await tx
      .insert(tables.groupMembers)
      .values({ groupId: group.id, userId: user.id, role: "admin" });
    await tx.insert(tables.activityLog).values({
      groupId: group.id,
      actorId: user.id,
      verb: "group.created",
      payload: { groupName: name },
    });
    return group.id;
  });

  redirect(`/groups/${groupId}`);
}

/** Join a group via its invite link. Full access on join — no roles to request. */
export async function joinGroup(code: string): Promise<void> {
  const user = await requireUser();
  const group = await getGroupByInviteCode(code);
  if (!group) redirect("/groups");

  await db
    .insert(tables.groupMembers)
    .values({ groupId: group.id, userId: user.id, role: "member" })
    .onConflictDoNothing();
  await db.insert(tables.activityLog).values({
    groupId: group.id,
    actorId: user.id,
    verb: "member.joined",
    payload: { memberName: user.name },
  });

  revalidatePath(`/groups/${group.id}`);
  redirect(`/groups/${group.id}`);
}

const ghostNameSchema = z.string().trim().min(1, "Name is required").max(80);

/**
 * Ghost members: split with someone who hasn't (or won't) sign up. A users
 * row with a NULL email — appears in splits and balances like anyone else,
 * but can never sign in as themselves. Admin-only, mirroring removeMember.
 */
export async function addGhostMember(
  groupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  if ((await getMemberRole(groupId, user.id)) !== "admin") {
    return { error: "Only a group admin can add members" };
  }
  const parsed = ghostNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  await db.transaction(async (tx) => {
    const [ghost] = await tx
      .insert(tables.users)
      .values({ id: nanoid(12), name: parsed.data, email: null })
      .returning({ id: tables.users.id });
    await tx
      .insert(tables.groupMembers)
      .values({ groupId, userId: ghost.id, role: "member" });
    await tx.insert(tables.activityLog).values({
      groupId,
      actorId: user.id,
      verb: "member.added",
      payload: { memberName: parsed.data },
    });
  });

  revalidatePath(`/groups/${groupId}`);
  return {};
}

/**
 * Revoke a member's access. Restricted to an admin. Their expense/settlement
 * history stays on the ledger untouched — only the `group_members` row goes
 * — so they must be settled up (zero balance) first, or the visible
 * balances would silently stop summing to what's actually owed.
 */
export async function removeMember(
  groupId: string,
  memberId: string,
): Promise<FormState> {
  const user = await requireUser();
  if ((await getMemberRole(groupId, user.id)) !== "admin") {
    return { error: "Only a group admin can remove members" };
  }
  if (memberId === user.id) {
    return { error: "You can't remove yourself — delete the group instead" };
  }

  const [members, balances] = await Promise.all([
    getGroupMembers(groupId),
    getGroupBalances(groupId),
  ]);
  const member = members.find((m) => m.id === memberId);
  if (!member) return { error: "Not a group member" };

  if ((balances.get(memberId) ?? 0) !== 0) {
    return { error: "Settle up with them before removing them from the group" };
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(tables.groupMembers)
      .where(
        and(
          eq(tables.groupMembers.groupId, groupId),
          eq(tables.groupMembers.userId, memberId),
        ),
      );
    await tx.insert(tables.activityLog).values({
      groupId,
      actorId: user.id,
      verb: "member.removed",
      payload: { memberName: member.name },
    });
  });

  revalidatePath(`/groups/${groupId}`);
  return {};
}

/**
 * Hard delete: the group and everything under it, children before parents.
 * Restricted to an admin member — everyone else can leave data alone.
 */
export async function deleteGroup(groupId: string): Promise<FormState> {
  const user = await requireUser();
  const group = await getGroup(groupId);
  if (!group) return { error: "Group not found" };
  if ((await getMemberRole(groupId, user.id)) !== "admin") {
    return { error: "Only a group admin can delete the group" };
  }

  await db.transaction(async (tx) => {
    const expenseIds = (
      await tx
        .select({ id: tables.expenses.id })
        .from(tables.expenses)
        .where(eq(tables.expenses.groupId, groupId))
    ).map((e) => e.id);
    if (expenseIds.length > 0) {
      const itemIds = (
        await tx
          .select({ id: tables.expenseItems.id })
          .from(tables.expenseItems)
          .where(inArray(tables.expenseItems.expenseId, expenseIds))
      ).map((i) => i.id);
      if (itemIds.length > 0) {
        await tx
          .delete(tables.expenseItemConsumers)
          .where(inArray(tables.expenseItemConsumers.itemId, itemIds));
      }
      await tx
        .delete(tables.expenseItems)
        .where(inArray(tables.expenseItems.expenseId, expenseIds));
      await tx
        .delete(tables.expenseShares)
        .where(inArray(tables.expenseShares.expenseId, expenseIds));
      await tx
        .delete(tables.expensePayers)
        .where(inArray(tables.expensePayers.expenseId, expenseIds));
      await tx.delete(tables.expenses).where(eq(tables.expenses.groupId, groupId));
    }
    await tx.delete(tables.settlements).where(eq(tables.settlements.groupId, groupId));
    await tx.delete(tables.activityLog).where(eq(tables.activityLog.groupId, groupId));
    await tx.delete(tables.groupMembers).where(eq(tables.groupMembers.groupId, groupId));
    await tx.delete(tables.groups).where(eq(tables.groups.id, groupId));
  });

  revalidatePath("/groups");
  redirect("/groups");
}
