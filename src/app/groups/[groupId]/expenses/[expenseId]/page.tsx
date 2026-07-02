import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getExpenseDetail,
  getExpenseHistory,
  getGroup,
  getGroupSettlements,
  isMember,
} from "@/lib/db/queries";
import { formatCents } from "@/lib/ledger/money";
import { DeleteExpenseButton } from "@/components/delete-expense-button";

export default async function ExpenseDetailPage(props: {
  params: Promise<{ groupId: string; expenseId: string }>;
}) {
  const user = await requireUser();
  const { groupId, expenseId } = await props.params;
  const group = getGroup(groupId);
  if (!group || !isMember(groupId, user.id)) notFound();

  const detail = getExpenseDetail(expenseId);
  if (!detail || detail.expense.groupId !== groupId) notFound();
  const { expense, payers, shares, items } = detail;
  const history = getExpenseHistory(expenseId);
  const hasSettlements = getGroupSettlements(groupId).some(
    (s) => s.status === "confirmed",
  );

  const lineItems = items.filter((i) => i.kind === "item");
  const overheads = items.filter((i) => i.kind !== "item");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{expense.description}</h1>
          <p className="text-sm text-zinc-500">
            {formatCents(expense.totalCents, expense.currency)} ·{" "}
            {expense.paidAt.toLocaleDateString()} · split: {expense.splitMethod}
            {expense.status !== "active" && (
              <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs">
                {expense.status}
              </span>
            )}
          </p>
        </div>
        {expense.status === "active" && (
          <div className="flex gap-2">
            <Link
              href={`/groups/${groupId}/expenses/${expenseId}/edit`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              Edit
            </Link>
            <DeleteExpenseButton
              expenseId={expenseId}
              groupId={groupId}
              hasSettlements={hasSettlements}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Paid by
          </h2>
          <ul className="space-y-1 text-sm">
            {payers.map((p) => (
              <li key={p.userId} className="flex justify-between">
                <span>{p.name}</span>
                <span className="font-medium">
                  {formatCents(p.amountCents, expense.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Shares (who consumed)
          </h2>
          <ul className="space-y-1 text-sm">
            {shares.map((s) => (
              <li key={s.userId} className="flex justify-between">
                <span>{s.name}</span>
                <span className="font-medium">
                  {formatCents(s.amountCents, expense.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {lineItems.length > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Receipt
          </h2>
          <ul className="space-y-1 text-sm">
            {lineItems.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span>{i.label}</span>
                <span>{formatCents(i.amountCents, expense.currency)}</span>
              </li>
            ))}
            {overheads.map((i) => (
              <li key={i.id} className="flex justify-between text-zinc-500">
                <span>
                  {i.label} <span className="text-xs">({i.kind})</span>
                </span>
                <span>{formatCents(i.amountCents, expense.currency)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {expense.notes && (
        <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          {expense.notes}
        </p>
      )}

      {history.length > 1 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Edit history
          </h2>
          <ul className="space-y-1 text-sm text-zinc-500">
            {history.map((h, idx) => (
              <li key={h.id}>
                {idx === 0 ? "Current: " : "Was: "}
                {h.description} — {formatCents(h.totalCents, h.currency)}{" "}
                <span className="text-xs">
                  (recorded {h.createdAt.toLocaleString()})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href={`/groups/${groupId}/expenses`}
        className="inline-block text-sm text-emerald-600 hover:underline"
      >
        ← All expenses
      </Link>
    </div>
  );
}
