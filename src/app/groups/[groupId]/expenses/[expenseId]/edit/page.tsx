import { notFound } from "next/navigation";
import { getExpenseDetail, getGroup, getGroupMembers } from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { updateExpense } from "@/server/expenses";
import { ExpenseForm } from "@/components/expense-form";
import { PageHeader } from "@/components/ui";

export default async function EditExpensePage(props: {
  params: Promise<{ groupId: string; expenseId: string }>;
}) {
  const { groupId, expenseId } = await props.params;
  await requireGroupMember(groupId);
  const [group, detail, allMembers] = await Promise.all([
    getGroup(groupId),
    getExpenseDetail(expenseId),
    getGroupMembers(groupId),
  ]);
  if (!group) notFound();

  if (
    !detail ||
    detail.expense.groupId !== groupId ||
    detail.expense.status !== "active"
  )
    notFound();

  const members = allMembers.map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <div className="rise">
        <PageHeader eyebrow={group.name} title="Edit expense" />
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">
          Edits never rewrite history: this saves a new version and keeps the
          old one in the audit trail.
        </p>
      </div>
      <div className="rise rise-1">
        <ExpenseForm
          groupId={groupId}
          currency={group.currency}
          members={members}
          defaultPayerId={members[0]?.id ?? ""}
          initial={{
            description: detail.expense.description,
            totalCents: detail.expense.totalCents,
            paidAt: detail.expense.paidAt.toISOString().slice(0, 10),
            notes: detail.expense.notes ?? undefined,
            payers: detail.payers.map((p) => ({
              userId: p.userId,
              amountCents: p.amountCents,
            })),
            split: detail.expense.splitInput ?? null,
          }}
          submitAction={updateExpense.bind(null, expenseId)}
        />
      </div>
    </div>
  );
}
