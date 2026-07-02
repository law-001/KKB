import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getExpenseDetail,
  getGroup,
  getGroupExpenses,
  getGroupMembers,
  getGroupSettlements,
} from "@/lib/db/queries";
import { formatCents } from "@/lib/ledger/money";

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
  const group = getGroup(groupId);
  if (!group) notFound();

  const members = getGroupMembers(groupId);
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

  for (const e of getGroupExpenses(groupId)) {
    const detail = getExpenseDetail(e.id);
    if (!detail) continue;
    const paid =
      detail.payers.find((p) => p.userId === memberId)?.amountCents ?? 0;
    const share =
      detail.shares.find((s) => s.userId === memberId)?.amountCents ?? 0;
    const delta = paid - share;
    if (paid !== 0 || share !== 0) {
      rows.push({
        date: e.paidAt,
        label: e.description,
        detail: `paid ${formatCents(paid, e.currency)} · share ${formatCents(share, e.currency)}`,
        deltaCents: delta,
      });
    }
  }

  for (const s of getGroupSettlements(groupId)) {
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{member.name}&rsquo;s tab</h1>
      <p
        className={`rounded-lg border px-4 py-3 text-sm ${
          final > 0
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : final < 0
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-zinc-200 bg-white text-zinc-600"
        }`}
      >
        {final > 0 && (
          <>
            The group owes {member.name}{" "}
            <strong>{formatCents(final, group.currency)}</strong> across{" "}
            {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          </>
        )}
        {final < 0 && (
          <>
            {member.name} owes the group{" "}
            <strong>{formatCents(-final, group.currency)}</strong> across{" "}
            {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          </>
        )}
        {final === 0 && <>{member.name} is all square.</>}
      </p>

      {withRunning.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white text-sm">
          {withRunning.map((r, i) => (
            <li key={i} className="flex items-center justify-between px-4 py-2.5">
              <span>
                <span className="font-medium">{r.label}</span>
                <span className="ml-2 text-xs text-zinc-400">
                  {r.date.toLocaleDateString()} · {r.detail}
                </span>
              </span>
              <span className="text-right">
                <span
                  className={
                    r.deltaCents > 0 ? "text-emerald-600" : "text-red-600"
                  }
                >
                  {r.deltaCents > 0 ? "+" : ""}
                  {formatCents(r.deltaCents, group.currency)}
                </span>
                <span className="ml-3 text-xs text-zinc-400">
                  bal {formatCents(r.running, group.currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
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
