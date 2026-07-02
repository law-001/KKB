import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGroup,
  getGroupBalances,
  getGroupExpenses,
  getGroupMembers,
} from "@/lib/db/queries";
import { formatCents } from "@/lib/ledger/money";
import { AddMemberForm } from "@/components/add-member-form";

export default async function GroupPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  const group = getGroup(groupId);
  if (!group) notFound();

  const members = getGroupMembers(groupId);
  const balances = getGroupBalances(groupId);
  const expenses = getGroupExpenses(groupId).slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{group.name}</h1>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/groups/${groupId}/expenses/new`}
            className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-700"
          >
            Add expense
          </Link>
          <Link
            href={`/groups/${groupId}/settle`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100"
          >
            Settle up
          </Link>
          <Link
            href={`/groups/${groupId}/activity`}
            className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-700 hover:bg-zinc-100"
          >
            Activity
          </Link>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Balances
        </h2>
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {members
            .map((m) => ({ ...m, balance: balances.get(m.id) ?? 0 }))
            .sort((a, b) => b.balance - a.balance)
            .map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <Link
                  href={`/groups/${groupId}/members/${m.id}`}
                  className="font-medium hover:underline"
                >
                  {m.name}
                </Link>
                <span
                  className={
                    m.balance > 0
                      ? "font-medium text-emerald-600"
                      : m.balance < 0
                        ? "font-medium text-red-600"
                        : "text-zinc-400"
                  }
                >
                  {m.balance > 0 ? "+" : ""}
                  {formatCents(m.balance, group.currency)}
                </span>
              </li>
            ))}
        </ul>
        <p className="mt-1.5 text-xs text-zinc-400">
          + means the group owes them; − means they owe the group. Tap a name
          for their full tab.
        </p>
        <div className="mt-3">
          <AddMemberForm groupId={groupId} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent expenses
          </h2>
          <Link
            href={`/groups/${groupId}/expenses`}
            className="text-sm text-emerald-600 hover:underline"
          >
            See all
          </Link>
        </div>
        {expenses.length === 0 ? (
          <p className="text-sm text-zinc-500">No expenses yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
            {expenses.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/groups/${groupId}/expenses/${e.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-zinc-50"
                >
                  <span>
                    <span className="font-medium">{e.description}</span>
                    <span className="ml-2 text-xs text-zinc-400">
                      {e.paidAt.toLocaleDateString()} · {e.splitMethod}
                    </span>
                  </span>
                  <span>{formatCents(e.totalCents, e.currency)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
