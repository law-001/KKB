import { notFound } from "next/navigation";
import { getExpenseDetail, getGroup, getGroupMembers } from "@/lib/db/queries";
import { updateExpense } from "@/server/expenses";
import { ExpenseForm } from "@/components/expense-form";

export default async function EditExpensePage(props: {
  params: Promise<{ groupId: string; expenseId: string }>;
}) {
  const { groupId, expenseId } = await props.params;
  const group = getGroup(groupId);
  if (!group) notFound();

  const detail = getExpenseDetail(expenseId);
  if (
    !detail ||
    detail.expense.groupId !== groupId ||
    detail.expense.status !== "active"
  )
    notFound();

  const members = getGroupMembers(groupId).map((m) => ({
    id: m.id,
    name: m.name,
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Edit expense</h1>
      <p className="text-sm text-zinc-500">
        Edits never rewrite history — this saves a new version and keeps the
        old one in the audit trail.
      </p>
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
  );
}
