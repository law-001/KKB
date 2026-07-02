import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getGroup, getGroupExpenses, getGroupMembers, isMember } from "@/lib/db/queries";
import { formatCents } from "@/lib/ledger/money";

export default async function ExpensesPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const user = await requireUser();
  const { groupId } = await props.params;
  const group = getGroup(groupId);
  if (!group || !isMember(groupId, user.id)) notFound();

  const members = getGroupMembers(groupId);
  const expenses = getGroupExpenses(groupId);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Expenses — {group.name}</h1>
        <Link
          href={`/groups/${groupId}/expenses/new`}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Add expense
        </Link>
      </div>
      {expenses.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing here yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {expenses.map((e) => (
            <li key={e.id}>
              <Link
                href={`/groups/${groupId}/expenses/${e.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50"
              >
                <span>
                  <span className="font-medium">{e.description}</span>
                  <span className="ml-2 text-xs text-zinc-400">
                    {e.paidAt.toLocaleDateString()} · {e.splitMethod} · added by{" "}
                    {nameOf(e.createdBy)}
                  </span>
                </span>
                <span className="text-sm font-medium">
                  {formatCents(e.totalCents, e.currency)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
