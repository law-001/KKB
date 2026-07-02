import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import {
  getExpenseDetail,
  getGroup,
  getGroupExpenses,
  getGroupMembers,
  getGroupSettlements,
  isMember,
} from "@/lib/db/queries";
import { computePairwiseDebts } from "@/lib/ledger/balances";
import { formatCents } from "@/lib/ledger/money";

/**
 * The per-pair drill-down: "Alex ↔ You", every expense and settlement between
 * the two with a running subtotal. This screen is what builds trust in the
 * numbers — it's a filtered scan of the same append-only ledger.
 */
export default async function MemberPairPage(props: {
  params: Promise<{ groupId: string; memberId: string }>;
}) {
  const user = await requireUser();
  const { groupId, memberId } = await props.params;
  const group = getGroup(groupId);
  if (!group || !isMember(groupId, user.id)) notFound();

  const members = getGroupMembers(groupId);
  const other = members.find((m) => m.id === memberId);
  if (!other) notFound();

  const me = user.id;
  const them = other.id;

  // Positive delta = they owe you more after this row.
  const rows: {
    date: Date;
    label: string;
    detail: string;
    deltaCents: number;
  }[] = [];

  for (const e of getGroupExpenses(groupId)) {
    const detail = getExpenseDetail(e.id);
    if (!detail) continue;
    const pair = computePairwiseDebts(
      [
        {
          payers: detail.payers.map((p) => ({ userId: p.userId, amountCents: p.amountCents })),
          shares: detail.shares.map((s) => ({ userId: s.userId, amountCents: s.amountCents })),
        },
      ],
      [],
    );
    const theyOweYou = pair.get(`${them}|${me}`) ?? 0;
    const youOweThem = pair.get(`${me}|${them}`) ?? 0;
    const delta = theyOweYou - youOweThem;
    if (delta !== 0) {
      rows.push({
        date: e.paidAt,
        label: e.description,
        detail: `${formatCents(e.totalCents, e.currency)} · ${e.splitMethod}`,
        deltaCents: delta,
      });
    }
  }

  for (const s of getGroupSettlements(groupId)) {
    if (s.status !== "confirmed") continue;
    if (s.fromUser === them && s.toUser === me) {
      rows.push({
        date: s.settledAt,
        label: `${other.name} paid you back`,
        detail: s.method ?? "settlement",
        deltaCents: -s.amountCents,
      });
    } else if (s.fromUser === me && s.toUser === them) {
      rows.push({
        date: s.settledAt,
        label: `You paid ${other.name} back`,
        detail: s.method ?? "settlement",
        deltaCents: s.amountCents,
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
      <h1 className="text-2xl font-bold">
        You ↔ {other.name}
        {other.email === null && (
          <span className="ml-2 align-middle rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-500">
            ghost
          </span>
        )}
      </h1>
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
            {other.name} owes you{" "}
            <strong>{formatCents(final, group.currency)}</strong> across{" "}
            {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          </>
        )}
        {final < 0 && (
          <>
            You owe {other.name}{" "}
            <strong>{formatCents(-final, group.currency)}</strong> across{" "}
            {rows.length} entr{rows.length === 1 ? "y" : "ies"}
          </>
        )}
        {final === 0 && <>You and {other.name} are square.</>}
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
