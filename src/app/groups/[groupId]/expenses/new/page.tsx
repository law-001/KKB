import { notFound } from "next/navigation";
import { getGroup, getGroupMembers } from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { createExpense } from "@/server/expenses";
import { scanReceipt } from "@/server/scan";
import { ExpenseForm } from "@/components/expense-form";
import { PageHeader } from "@/components/ui";

// Receipt scanning calls Gemini, which can take longer than the default
// action timeout. Server-action maxDuration is set at the page level.
export const maxDuration = 60;

export default async function NewExpensePage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  await requireGroupMember(groupId);
  const [group, allMembers] = await Promise.all([
    getGroup(groupId),
    getGroupMembers(groupId),
  ]);
  if (!group) notFound();

  const members = allMembers.map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <div className="rise">
        <PageHeader eyebrow={group.name} title="Add expense" />
      </div>
      <div className="rise rise-1">
        <ExpenseForm
          groupId={groupId}
          currency={group.currency}
          members={members}
          defaultPayerId={members[0]?.id ?? ""}
          submitAction={createExpense.bind(null, groupId)}
          scanAction={
            process.env.GEMINI_API_KEY ? scanReceipt.bind(null, groupId) : undefined
          }
        />
      </div>
    </div>
  );
}
