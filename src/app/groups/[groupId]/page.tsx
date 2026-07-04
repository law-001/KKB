import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getGroup,
  getGroupBalances,
  getGroupExpenses,
  getGroupMembers,
} from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { InviteLink } from "@/components/invite-link";
import { AddGhostMemberForm } from "@/components/add-ghost-member-form";
import { DeleteGroupButton } from "@/components/delete-group-button";
import { RemoveMemberButton } from "@/components/remove-member-button";
import { Amount, Dots, IconPlus, PageHeader } from "@/components/ui";

export default async function GroupPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  const user = await requireGroupMember(groupId);
  const isAdmin = user.role === "admin";
  // Independent reads — fetch in parallel, the DB is a ~90ms roundtrip away.
  const [group, members, balances, expenses] = await Promise.all([
    getGroup(groupId),
    getGroupMembers(groupId),
    getGroupBalances(groupId),
    getGroupExpenses(groupId),
  ]);
  if (!group) notFound();

  // Group by paid-at day; take whole days (so day totals stay honest) until
  // we've shown at least 6 expenses.
  const days: { key: string; date: Date; totalCents: number; rows: typeof expenses }[] = [];
  for (const e of expenses) {
    const key = e.paidAt.toDateString();
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, date: e.paidAt, totalCents: 0, rows: [] };
      days.push(day);
    }
    day.totalCents += e.totalCents;
    day.rows.push(e);
  }
  const recentDays: typeof days = [];
  let shown = 0;
  for (const d of days) {
    if (shown >= 6) break;
    recentDays.push(d);
    shown += d.rows.length;
  }

  return (
    <div className="space-y-8">
      <div className="rise">
        <PageHeader eyebrow={`Group · ${group.currency}`} title={group.name}>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/groups/${groupId}/expenses/new`}
              className="btn btn-primary min-h-10 px-4 text-sm"
            >
              <IconPlus className="size-4" />
              Add expense
            </Link>
            <Link
              href={`/groups/${groupId}/settle`}
              className="btn btn-ghost min-h-10 px-4 text-sm"
            >
              Settle up
            </Link>
            <Link
              href={`/groups/${groupId}/activity`}
              className="btn btn-ghost min-h-10 px-4 text-sm"
            >
              Activity
            </Link>
          </div>
        </PageHeader>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-12">
        <section className="rise rise-1 min-w-0">
          <h2 className="microlabel mb-3">Balances</h2>
          <ul className="space-y-1">
            {members
              .map((m) => ({ ...m, balance: balances.get(m.id) ?? 0 }))
              .sort((a, b) => b.balance - a.balance)
              .map((m) => (
                <li key={m.id} className="flex items-baseline text-sm">
                  <Link
                    href={`/groups/${groupId}/members/${m.id}`}
                    className="flex min-h-9 min-w-0 items-baseline gap-1.5 truncate py-2 font-medium underline-offset-4 transition-colors hover:text-accent-deep hover:underline"
                  >
                    <span className="truncate">{m.name}</span>
                    {!m.email && (
                      <span className="microlabel shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-ink-faint">
                        no account
                      </span>
                    )}
                  </Link>
                  <Dots />
                  <Amount
                    cents={m.balance}
                    currency={group.currency}
                    signed
                    className="py-2 font-medium"
                  />
                  {isAdmin && m.id !== user.id && (
                    <RemoveMemberButton
                      groupId={groupId}
                      memberId={m.id}
                      memberName={m.name}
                    />
                  )}
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-ink-faint">
            <span className="font-mono text-pos">+</span> the group owes them
            · <span className="font-mono text-neg">−</span> they owe the
            group. Tap a name for their full tab.
          </p>
          <div className="mt-5 space-y-5 border-t border-dashed border-line pt-5">
            <InviteLink code={group.inviteCode} />
            {isAdmin && <AddGhostMemberForm groupId={groupId} />}
          </div>
        </section>

        <section className="rise rise-2 min-w-0">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="microlabel">Recent expenses</h2>
            <Link
              href={`/groups/${groupId}/expenses`}
              className="text-sm font-medium text-accent-deep underline-offset-4 hover:underline"
            >
              See all
            </Link>
          </div>
          {expenses.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
              <p className="text-sm font-medium text-ink-soft">
                No expenses yet
              </p>
              <p className="mt-1 text-sm text-ink-faint">
                Add the first bill and the balances above come alive.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-cream">
              {recentDays.map((day) => (
                <section key={day.key}>
                  <h3 className="flex items-baseline border-b border-dashed border-line px-4 pb-2 pt-3 microlabel">
                    <span>
                      {day.date.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <Dots />
                    <Amount cents={day.totalCents} currency={group.currency} />
                  </h3>
                  <ul className="divide-y divide-line-soft border-b border-line-soft last:border-b-0">
                    {day.rows.map((e) => (
                      <li key={e.id}>
                        <Link
                          href={`/groups/${groupId}/expenses/${e.id}`}
                          className="flex min-h-14 items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {e.description}
                            </span>
                            <span className="microlabel mt-0.5 block normal-case tracking-normal">
                              {e.splitMethod}
                            </span>
                          </span>
                          <Amount
                            cents={e.totalCents}
                            currency={e.currency}
                            className="shrink-0 text-sm font-medium"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="rise rise-3 border-t border-dashed border-line pt-6">
        <h2 className="microlabel mb-3">Danger zone</h2>
        <DeleteGroupButton groupId={groupId} />
      </div>
    </div>
  );
}
