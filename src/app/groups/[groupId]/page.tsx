import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getGroup,
  getGroupBalances,
  getGroupExpenses,
  getGroupMembers,
  getGroupSettlements,
  isMember,
} from "@/lib/db/queries";
import { formatCents } from "@/lib/ledger/money";
import { GhostMemberForm } from "@/components/ghost-member-form";
import { SettlementActions } from "@/components/settlement-actions";

export default async function GroupPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const user = await requireUser();
  const { groupId } = await props.params;
  const group = getGroup(groupId);
  if (!group || !isMember(groupId, user.id)) notFound();

  const members = getGroupMembers(groupId);
  const balances = getGroupBalances(groupId);
  const expenses = getGroupExpenses(groupId).slice(0, 5);
  const pendingForMe = getGroupSettlements(groupId).filter(
    (s) => s.status === "pending" && s.toUser === user.id,
  );
  const memberName = (id: string) =>
    members.find((m) => m.id === id)?.name ?? "?";
  const myBalance = balances.get(user.id) ?? 0;

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

      <div
        className={`rounded-lg border px-4 py-3 ${
          myBalance > 0
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : myBalance < 0
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-zinc-200 bg-white text-zinc-600"
        }`}
      >
        {myBalance > 0 && (
          <>
            The group owes you{" "}
            <strong>{formatCents(myBalance, group.currency)}</strong>
          </>
        )}
        {myBalance < 0 && (
          <>
            You owe the group{" "}
            <strong>{formatCents(-myBalance, group.currency)}</strong>
          </>
        )}
        {myBalance === 0 && <>You&rsquo;re all settled up 🎉</>}
      </div>

      {pendingForMe.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="mb-2 text-sm font-semibold text-amber-800">
            Waiting for your confirmation
          </h2>
          <ul className="space-y-2">
            {pendingForMe.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  <strong>{memberName(s.fromUser)}</strong> says they paid you{" "}
                  <strong>{formatCents(s.amountCents, group.currency)}</strong>
                  {s.method ? ` via ${s.method}` : ""}
                </span>
                <SettlementActions settlementId={s.id} />
              </li>
            ))}
          </ul>
        </section>
      )}

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
                <span>
                  <Link
                    href={`/groups/${groupId}/members/${m.id}`}
                    className="font-medium hover:underline"
                  >
                    {m.name}
                  </Link>
                  {m.email === null && (
                    <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                      ghost
                    </span>
                  )}
                  {m.id === user.id && (
                    <span className="ml-2 text-xs text-zinc-400">(you)</span>
                  )}
                </span>
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
        <div className="mt-3">
          <GhostMemberForm groupId={groupId} />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          Invite link:{" "}
          <code className="rounded bg-zinc-100 px-1.5 py-0.5">
            /join/{group.inviteCode}
          </code>
        </p>
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
