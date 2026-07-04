import { notFound } from "next/navigation";
import {
  getGroup,
  getGroupMembers,
  getGroupSettlements,
  getMemberExpenseRows,
} from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { formatCents } from "@/lib/ledger/money";
import { Amount, BackLink, PageHeader } from "@/components/ui";

/**
 * A member's full tab: every expense and settlement that touched their
 * balance, with a running subtotal. This screen is what builds trust in the
 * numbers — it's a filtered scan of the same append-only ledger, and its
 * final line always equals the balance on the group page.
 */
export default async function MemberTabPage(props: {
  params: Promise<{ groupId: string; memberId: string }>;
}) {
  const { groupId, memberId } = await props.params;
  await requireGroupMember(groupId);
  const [group, members, memberExpenses, settlements] = await Promise.all([
    getGroup(groupId),
    getGroupMembers(groupId),
    getMemberExpenseRows(groupId, memberId),
    getGroupSettlements(groupId),
  ]);
  if (!group) notFound();

  const member = members.find((m) => m.id === memberId);
  if (!member) notFound();
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  // Positive delta = the group owes them more after this row.
  const rows: {
    date: Date;
    label: string;
    detail: string;
    deltaCents: number;
  }[] = [];

  for (const e of memberExpenses) {
    if (e.paidCents === 0 && e.shareCents === 0) continue;
    rows.push({
      date: e.paidAt,
      label: e.description,
      detail: `paid ${formatCents(e.paidCents, e.currency)} · share ${formatCents(e.shareCents, e.currency)}`,
      deltaCents: e.paidCents - e.shareCents,
    });
  }

  for (const s of settlements) {
    if (s.status !== "confirmed") continue;
    if (s.fromUser === memberId) {
      rows.push({
        date: s.settledAt,
        label: `Paid ${nameOf(s.toUser)} back`,
        detail: s.method ?? "settlement",
        deltaCents: s.amountCents,
      });
    } else if (s.toUser === memberId) {
      rows.push({
        date: s.settledAt,
        label: `${nameOf(s.fromUser)} paid them back`,
        detail: s.method ?? "settlement",
        deltaCents: -s.amountCents,
      });
    }
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  let running = 0;
  const withRunning = rows.map((r) => {
    running += r.deltaCents;
    return { ...r, running };
  });
  const final = running;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rise">
        <PageHeader eyebrow={group.name} title={`${member.name}’s tab`} />
      </div>

      <div
        className={`rise rise-1 rounded-xl px-4 py-3.5 text-sm leading-relaxed ${
          final > 0
            ? "bg-pos-soft text-pos"
            : final < 0
              ? "bg-neg-soft text-neg"
              : "border border-line bg-cream text-ink-soft"
        }`}
      >
        {final > 0 && (
          <>
            The group owes {member.name}{" "}
            <strong className="font-mono tabular-nums">
              {formatCents(final, group.currency)}
            </strong>{" "}
            across {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          </>
        )}
        {final < 0 && (
          <>
            {member.name} owes the group{" "}
            <strong className="font-mono tabular-nums">
              {formatCents(-final, group.currency)}
            </strong>{" "}
            across {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          </>
        )}
        {final === 0 && <>{member.name} is all square.</>}
      </div>

      {withRunning.length > 0 && (
        <ul className="rise rise-2 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-cream text-sm">
          {withRunning.map((r, i) => (
            <li
              key={i}
              className="flex items-center justify-between gap-4 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.label}</span>
                <span className="microlabel mt-0.5 block normal-case tracking-normal">
                  {r.date.toLocaleDateString()} · {r.detail}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <Amount
                  cents={r.deltaCents}
                  currency={group.currency}
                  signed
                  className="block font-medium"
                />
                <span className="microlabel mt-0.5 block normal-case tracking-normal">
                  bal {formatCents(r.running, group.currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="rise rise-3">
        <BackLink href={`/groups/${groupId}`}>Back to group</BackLink>
      </div>
    </div>
  );
}
