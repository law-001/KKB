"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, tables } from "@/lib/db";
import { SUPPORTED_CURRENCIES } from "@/lib/ledger/money";

export interface FormState {
  error?: string;
}

const createGroupSchema = z.object({
  name: z.string().trim().min(1, "Group name is required").max(80),
  currency: z.string().refine((c) => SUPPORTED_CURRENCIES.includes(c), {
    message: "Unsupported currency",
  }),
  // Comma- or newline-separated member names; the app has no accounts, so
  // members are just names.
  members: z
    .string()
    .transform((raw) =>
      raw
        .split(/[,\n]/)
        .map((n) => n.trim())
        .filter((n) => n.length > 0),
    )
    .refine((names) => names.length >= 1, "Add at least one member")
    .refine((names) => names.every((n) => n.length <= 80), "Name too long")
    .refine(
      (names) => new Set(names.map((n) => n.toLowerCase())).size === names.length,
      "Duplicate member name",
    ),
});

export async function createGroup(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = createGroupSchema.safeParse({
    name: formData.get("name"),
    currency: formData.get("currency"),
    members: formData.get("members") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { name, currency, members } = parsed.data;

  const groupId = db.transaction((tx) => {
    const memberRows = tx
      .insert(tables.users)
      .values(members.map((n) => ({ name: n, email: null, passwordHash: null })))
      .returning({ id: tables.users.id })
      .all();
    const group = tx
      .insert(tables.groups)
      .values({ name, currency, createdBy: memberRows[0].id })
      .returning({ id: tables.groups.id })
      .get();
    tx.insert(tables.groupMembers)
      .values(
        memberRows.map((m, i) => ({
          groupId: group.id,
          userId: m.id,
          role: i === 0 ? ("admin" as const) : ("member" as const),
        })),
      )
      .run();
    tx.insert(tables.activityLog)
      .values({
        groupId: group.id,
        actorId: memberRows[0].id,
        verb: "group.created",
        payload: { groupName: name, memberNames: members },
      })
      .run();
    return group.id;
  });

  redirect(`/groups/${groupId}`);
}

const memberNameSchema = z.string().trim().min(1, "Name is required").max(80);

/** Add a member by name — no account, no invite; the app is open. */
export async function addMember(
  groupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = memberNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  db.transaction((tx) => {
    const member = tx
      .insert(tables.users)
      .values({ name: parsed.data, email: null, passwordHash: null })
      .returning({ id: tables.users.id })
      .get();
    tx.insert(tables.groupMembers)
      .values({ groupId, userId: member.id, role: "member" })
      .run();
    tx.insert(tables.activityLog)
      .values({
        groupId,
        actorId: member.id,
        verb: "member.added",
        payload: { memberName: parsed.data },
      })
      .run();
  });

  revalidatePath(`/groups/${groupId}`);
  return {};
}
