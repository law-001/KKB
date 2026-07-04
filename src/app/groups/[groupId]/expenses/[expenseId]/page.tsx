import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getExpenseDetail,
  getExpenseHistory,
  getExpensePayments,
  getGroup,
  getGroupSettlements,
} from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { formatCents } from "@/lib/ledger/money";
import { DeleteExpenseButton } from "@/components/delete-expense-button";
import { ExpensePaymentControls } from "@/components/expense-payment-controls";
import { Amount, BackLink, Dots } from "@/components/ui";

export default async function ExpenseDetailPage(props: {
  params: Promise<{ groupId: string; expenseId: string }>;
}) {
  const { groupId, expenseId } = await props.params;
  await requireGroupMember(groupId);
  const [group, detail, history, groupSettlements] = await Promise.all([
    getGroup(groupId),
    getExpenseDetail(expenseId),
    getExpenseHistory(expenseId),
    getGroupSettlements(groupId),
  ]);
  if (!group) notFound();

  if (!detail || detail.expense.groupId !== groupId) notFound();
  const { expense, payers, shares, items } = detail;
  const hasSettlements = groupSettlements.some((s) => s.status === "confirmed");

  const lineItems = items.filter((i) => i.kind === "item");
  const overheads = items.filter((i) => i.kind !== "item");

  // Table-side cash linked to this expense (whole edit chain): what each
  // person has handed the payer, and any sukli already returned.
  const payments = await getExpensePayments(history.map((h) => h.id));
  const payerIds = new Set(payers.map((p) => p.userId));
  // KKB mode: payers ≡ shares — nobody fronted, nothing to mark paid.
  const kkb =
    payers.length === shares.length &&
    shares.every((s) => payerIds.has(s.userId));
  const paidBy = (userId: string) =>
    payments
      .filter((s) => s.fromUser === userId)
      .reduce((sum, s) => sum + s.amountCents, 0);
  const sukliGivenTo = (userId: string) =>
    payments
      .filter((s) => s.toUser === userId)
      .reduce((sum, s) => sum + s.amountCents, 0);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rise flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="microlabel mb-1">
            Expense · {expense.paidAt.toLocaleDateString()} ·{" "}
            {expense.splitMethod}
            {expense.status !== "active" && ` · ${expense.status}`}
          </p>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {expense.description}
          </h1>
          <p className="mt-1 font-mono text-lg font-medium tabular-nums text-ink-soft">
            {formatCents(expense.totalCents, expense.currency)}
          </p>
        </div>
        {expense.status === "active" && (
          <div className="flex gap-2">
            <Link
              href={`/groups/${groupId}/expenses/${expenseId}/edit`}
              className="btn btn-ghost min-h-10 px-4 text-sm"
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

      <div className="rise rise-1 card tear-b bg-cream p-4 sm:p-5">
        <div className="grid gap-6 sm:grid-cols-2">
          <section className="min-w-0">
            <h2 className="microlabel mb-2 border-b border-dashed border-line pb-2">
              Paid by
            </h2>
            <ul className="space-y-1 text-sm">
              {payers.map((p) => (
                <li key={p.userId} className="flex items-baseline">
                  <span className="truncate py-0.5">{p.name}</span>
                  <Dots />
                  <Amount
                    cents={p.amountCents}
                    currency={expense.currency}
                    className="py-0.5 font-medium"
                  />
                </li>
              ))}
            </ul>
          </section>
          <section className="min-w-0">
            <h2 className="microlabel mb-2 border-b border-dashed border-line pb-2">
              Shares · who consumed
            </h2>
            <ul className="space-y-1 text-sm">
              {shares.map((s) => (
                <li key={s.userId}>
                  <div className="flex items-baseline">
                    <span className="truncate py-0.5">{s.name}</span>
                    <Dots />
                    <Amount
                      cents={s.amountCents}
                      currency={expense.currency}
                      className="py-0.5 font-medium"
                    />
                  </div>
                  {payerIds.has(s.userId) ? (
                    <p className="microlabel mt-0.5 normal-case tracking-normal">
                      {kkb ? "paid their own share" : "fronted the bill"}
                    </p>
                  ) : (
                    <ExpensePaymentControls
                      expenseId={expenseId}
                      userId={s.userId}
                      name={s.name}
                      currency={expense.currency}
                      shareCents={s.amountCents}
                      paidCents={paidBy(s.userId)}
                      sukliGivenCents={sukliGivenTo(s.userId)}
                      active={expense.status === "active"}
                    />
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {lineItems.length > 0 && (
          <section className="mt-6">
            <h2 className="microlabel mb-2 border-b border-dashed border-line pb-2">
              Receipt
            </h2>
            <ul className="space-y-1 text-sm">
              {lineItems.map((i) => (
                <li key={i.id} className="flex items-baseline">
                  <span className="truncate py-0.5">{i.label}</span>
                  <Dots />
                  <Amount
                    cents={i.amountCents}
                    currency={expense.currency}
                    className="py-0.5"
                  />
                </li>
              ))}
              {overheads.map((i) => (
                <li
                  key={i.id}
                  className="flex items-baseline text-ink-faint"
                >
                  <span className="truncate py-0.5">
                    {i.label}{" "}
                    <span className="microlabel normal-case tracking-normal">
                      ({i.kind})
                    </span>
                  </span>
                  <Dots />
                  <Amount
                    cents={i.amountCents}
                    currency={expense.currency}
                    className="py-0.5"
                  />
                </li>
              ))}
              <li className="mt-1 flex items-baseline border-t border-dashed border-line pt-2 font-medium">
                <span className="py-0.5">Total</span>
                <Dots />
                <Amount
                  cents={expense.totalCents}
                  currency={expense.currency}
                  className="py-0.5"
                />
              </li>
            </ul>
          </section>
        )}
      </div>

      {expense.notes && (
        <p className="rise rise-2 text-sm leading-relaxed text-ink-soft">
          <span className="microlabel mr-2">Notes</span>
          {expense.notes}
        </p>
      )}

      {history.length > 1 && (
        <section className="rise rise-2">
          <h2 className="microlabel mb-2">Edit history</h2>
          <ul className="space-y-1.5 text-sm text-ink-faint">
            {history.map((h, idx) => (
              <li key={h.id}>
                <span className="microlabel mr-2">
                  {idx === 0 ? "Current" : "Was"}
                </span>
                {h.description} ·{" "}
                <span className="font-mono tabular-nums">
                  {formatCents(h.totalCents, h.currency)}
                </span>{" "}
                <span className="text-xs">
                  (recorded {h.createdAt.toLocaleString()})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="rise rise-3">
        <BackLink href={`/groups/${groupId}/expenses`}>All expenses</BackLink>
      </div>
    </div>
  );
}
