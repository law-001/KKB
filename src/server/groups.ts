"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { getGroupByInviteCode, isMember } from "@/lib/db/queries";
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

  const groupId = db.transaction((tx) => {
    const group = tx
      .insert(tables.groups)
      .values({ ...parsed.data, createdBy: user.id })
      .returning({ id: tables.groups.id })
      .get();
    tx.insert(tables.groupMembers)
      .values({ groupId: group.id, userId: user.id, role: "admin" })
      .run();
    tx.insert(tables.activityLog)
      .values({
        groupId: group.id,
        actorId: user.id,
        verb: "group.created",
        payload: { groupName: parsed.data.name },
      })
      .run();
    return group.id;
  });

  redirect(`/groups/${groupId}`);
}

export async function joinGroup(code: string): Promise<void> {
  const user = await requireUser();
  const group = getGroupByInviteCode(code);
  if (!group) redirect("/groups?error=invalid-invite");

  db.transaction((tx) => {
    // Duplicate joins are a no-op (upsert semantics).
    const existing = tx
      .select({ userId: tables.groupMembers.userId })
      .from(tables.groupMembers)
      .where(
        and(
          eq(tables.groupMembers.groupId, group.id),
          eq(tables.groupMembers.userId, user.id),
        ),
      )
      .get();
    if (existing) return;
    tx.insert(tables.groupMembers)
      .values({ groupId: group.id, userId: user.id, role: "member" })
      .run();
    tx.insert(tables.activityLog)
      .values({
        groupId: group.id,
        actorId: user.id,
        verb: "member.joined",
        payload: { memberName: user.name },
      })
      .run();
  });

  redirect(`/groups/${group.id}`);
}

const ghostSchema = z.string().trim().min(1, "Name is required").max(80);

/**
 * Ghost members: split with friends who haven't signed up. A users row with
 * NULL email; appears in splits and balances like anyone else. The claim
 * flow (merging when they register) is deferred by design — see the plan.
 */
export async function addGhostMember(
  groupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  if (!isMember(groupId, user.id)) return { error: "Not a member of this group" };
  const parsed = ghostSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  db.transaction((tx) => {
    const ghost = tx
      .insert(tables.users)
      .values({ name: parsed.data, email: null, passwordHash: null })
      .returning({ id: tables.users.id })
      .get();
    tx.insert(tables.groupMembers)
      .values({ groupId, userId: ghost.id, role: "member" })
      .run();
    tx.insert(tables.activityLog)
      .values({
        groupId,
        actorId: user.id,
        verb: "member.ghost_added",
        payload: { memberName: parsed.data },
      })
      .run();
  });

  revalidatePath(`/groups/${groupId}`);
  return {};
}
