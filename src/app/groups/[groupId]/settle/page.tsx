import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGroup,
  getGroupBalances,
  getGroupMembers,
  getGroupSettlements,
  getLedgerForPairwise,
} from "@/lib/db/queries";
import { simplifyDebts } from "@/lib/ledger/simplify";
import { computePairwiseDebts } from "@/lib/ledger/balances";
import { formatCents } from "@/lib/ledger/money";
import {
  ManualSettlementForm,
  RecordTransferButton,
} from "@/components/settle-forms";

export default async function SettlePage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  const group = getGroup(groupId);
  if (!group) notFound();

  const members = getGroupMembers(groupId);
  const balances = getGroupBalances(groupId);
  const plan = simplifyDebts(balances);
  const ledger = getLedgerForPairwise(groupId);
  const pairwise = computePairwiseDebts(ledger.expenses, ledger.settlements);
  const settlements = getGroupSettlements(groupId).slice(0, 10);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  const memberOptions = members.map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Settle up — {group.name}</h1>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Suggested plan (fewest transfers)
        </h2>
        <p className="mb-3 text-xs text-zinc-400">
          A suggestion, not an obligation — record whatever actually happens.
        </p>
        {plan.length === 0 ? (
          <p className="text-sm text-emerald-600">
            Everyone is at zero. Nothing to settle 🎉
          </p>
        ) : (
          <ul className="space-y-2">
            {plan.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span>
                  <strong>{nameOf(t.from)}</strong> pays{" "}
                  <strong>{nameOf(t.to)}</strong>{" "}
                  <span className="font-medium text-emerald-700">
                    {formatCents(t.amountCents, group.currency)}
                  </span>
                </span>
                <RecordTransferButton
                  groupId={groupId}
                  fromUser={t.from}
                  toUser={t.to}
                  amountCents={t.amountCents}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Record a payment manually
        </h2>
        <ManualSettlementForm
          groupId={groupId}
          currency={group.currency}
          members={memberOptions}
          overpayWarnings={Object.fromEntries(pairwise)}
        />
      </section>

      {pairwise.size > 0 && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Who owes whom, exactly
          </h2>
          <p className="mb-3 text-xs text-zinc-400">
            Pairwise view from actual shared expenses — &ldquo;you owe{" "}
            <em>me</em> from three dinners ago&rdquo;, preserved literally.
          </p>
          <ul className="space-y-1 text-sm">
            {[...pairwise.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([key, cents]) => {
                const [from, to] = key.split("|");
                return (
                  <li key={key} className="flex justify-between">
                    <span>
                      {nameOf(from)} → {nameOf(to)}
                    </span>
                    <span className="font-medium">
                      {formatCents(cents, group.currency)}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {settlements.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent settlements
          </h2>
          <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
            {settlements.map((s) => (
              <li key={s.id} className="flex justify-between px-4 py-2.5">
                <span>
                  {nameOf(s.fromUser)} → {nameOf(s.toUser)}
                  {s.method ? ` (${s.method})` : ""}
                </span>
                <span className="flex items-center gap-2">
                  {formatCents(s.amountCents, group.currency)}
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      s.status === "confirmed"
                        ? "bg-emerald-100 text-emerald-700"
                        : s.status === "pending"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-zinc-100 text-zinc-500 line-through"
                    }`}
                  >
                    {s.status}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href={`/groups/${groupId}`}
        className="inline-block text-sm text-emerald-600 hover:underline"
      >
        ← Back to group
      </Link>
    </div>
  );
}
