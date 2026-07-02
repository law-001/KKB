import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getGroup, getGroupMembers, isMember } from "@/lib/db/queries";
import { createExpense } from "@/server/expenses";
import { ExpenseForm } from "@/components/expense-form";

export default async function NewExpensePage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const user = await requireUser();
  const { groupId } = await props.params;
  const group = getGroup(groupId);
  if (!group || !isMember(groupId, user.id)) notFound();

  const members = getGroupMembers(groupId).map((m) => ({
    id: m.id,
    name: m.name,
    isGhost: m.email === null,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Add expense — {group.name}</h1>
      <ExpenseForm
        groupId={groupId}
        currency={group.currency}
        members={members}
        currentUserId={user.id}
        submitAction={createExpense.bind(null, groupId)}
      />
    </div>
  );
}
