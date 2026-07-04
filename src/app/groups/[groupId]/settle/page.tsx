import { notFound } from "next/navigation";
import {
  getGroup,
  getGroupBalances,
  getGroupMembers,
  getGroupSettlements,
  getLedgerForPairwise,
} from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { simplifyDebts } from "@/lib/ledger/simplify";
import { computePairwiseDebts } from "@/lib/ledger/balances";
import {
  ManualSettlementForm,
  RecordTransferButton,
} from "@/components/settle-forms";
import {
  Amount,
  BackLink,
  Dots,
  IconArrowRight,
  IconCheck,
  PageHeader,
} from "@/components/ui";

export default async function SettlePage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  await requireGroupMember(groupId);
  const [group, members, balances, ledger, allSettlements] = await Promise.all([
    getGroup(groupId),
    getGroupMembers(groupId),
    getGroupBalances(groupId),
    getLedgerForPairwise(groupId),
    getGroupSettlements(groupId),
  ]);
  if (!group) notFound();

  const plan = simplifyDebts(balances);
  const pairwise = computePairwiseDebts(ledger.expenses, ledger.settlements);
  const settlements = allSettlements.slice(0, 10);
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  const memberOptions = members.map((m) => ({ id: m.id, name: m.name }));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="rise">
        <PageHeader eyebrow={group.name} title="Settle up" />
      </div>

      <section className="rise rise-1">
        <h2 className="microlabel mb-1">Suggested plan · fewest transfers</h2>
        <p className="mb-3 text-sm text-ink-faint">
          A suggestion, not an obligation. Record whatever actually happens.
        </p>
        {plan.length === 0 ? (
          <p className="flex items-center gap-2 rounded-xl bg-pos-soft px-4 py-3 text-sm font-medium text-pos">
            <IconCheck className="size-4" />
            Everyone is at zero. Nothing to settle.
          </p>
        ) : (
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-cream">
            {plan.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{nameOf(t.from)}</span>
                  <IconArrowRight className="size-3.5 shrink-0 text-ink-faint" />
                  <span className="truncate font-medium">{nameOf(t.to)}</span>
                  <Amount
                    cents={t.amountCents}
                    currency={group.currency}
                    className="ml-1 font-medium text-accent-deep"
                  />
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

      <section className="rise rise-2 card p-4 sm:p-5">
        <h2 className="microlabel mb-3">Record a payment manually</h2>
        <ManualSettlementForm
          groupId={groupId}
          currency={group.currency}
          members={memberOptions}
          overpayWarnings={Object.fromEntries(pairwise)}
        />
      </section>

      {pairwise.size > 0 && (
        <section className="rise rise-3">
          <h2 className="microlabel mb-1">Who owes whom, exactly</h2>
          <p className="mb-3 text-sm text-ink-faint">
            Pairwise view from actual shared expenses: &ldquo;you owe{" "}
            <em>me</em>
            {" from three dinners ago"}&rdquo;, preserved literally.
          </p>
          <ul className="space-y-1 text-sm">
            {[...pairwise.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([key, cents]) => {
                const [from, to] = key.split("|");
                return (
                  <li key={key} className="flex items-baseline">
                    <span className="flex min-w-0 items-center gap-1.5 py-1">
                      <span className="truncate">{nameOf(from)}</span>
                      <IconArrowRight className="size-3 shrink-0 text-ink-faint" />
                      <span className="truncate">{nameOf(to)}</span>
                    </span>
                    <Dots />
                    <Amount
                      cents={cents}
                      currency={group.currency}
                      className="py-1 font-medium"
                    />
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {settlements.length > 0 && (
        <section className="rise rise-4">
          <h2 className="microlabel mb-3">Recent settlements</h2>
          <ul className="divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-cream text-sm">
            {settlements.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate">{nameOf(s.fromUser)}</span>
                  <IconArrowRight className="size-3 shrink-0 text-ink-faint" />
                  <span className="truncate">{nameOf(s.toUser)}</span>
                  {s.method && (
                    <span className="microlabel normal-case tracking-normal">
                      via {s.method}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <Amount cents={s.amountCents} currency={group.currency} />
                  <span
                    className={`microlabel rounded-full px-2 py-0.5 ${
                      s.status === "confirmed"
                        ? "bg-pos-soft text-pos"
                        : s.status === "pending"
                          ? "bg-accent-soft text-warn"
                          : "bg-paper text-ink-faint line-through"
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

      <BackLink href={`/groups/${groupId}`}>Back to group</BackLink>
    </div>
  );
}
