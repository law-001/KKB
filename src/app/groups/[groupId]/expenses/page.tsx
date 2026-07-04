import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroup, getGroupExpenses, getGroupMembers } from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import {
  Amount,
  BackLink,
  Dots,
  EmptyState,
  IconPlus,
  PageHeader,
} from "@/components/ui";

export default async function ExpensesPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  await requireGroupMember(groupId);
  const [group, members, expenses] = await Promise.all([
    getGroup(groupId),
    getGroupMembers(groupId),
    getGroupExpenses(groupId),
  ]);
  if (!group) notFound();
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  // One section per paid-at day (expenses arrive newest first), with a
  // running total for that day.
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rise">
        <PageHeader eyebrow={group.name} title="Expenses">
          <Link
            href={`/groups/${groupId}/expenses/new`}
            className="btn btn-primary min-h-10 px-4 text-sm"
          >
            <IconPlus className="size-4" />
            Add expense
          </Link>
        </PageHeader>
      </div>

      {expenses.length === 0 ? (
        <div className="rise rise-1">
          <EmptyState
            title="Nothing here yet"
            hint="Every bill you add lands on this list, newest first."
          />
        </div>
      ) : (
        <div className="rise rise-1 overflow-hidden rounded-xl border border-line bg-cream">
          {days.map((day) => (
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
                          {e.splitMethod} · added by {nameOf(e.createdBy)}
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

      <div className="rise rise-2">
        <BackLink href={`/groups/${groupId}`}>Back to group</BackLink>
      </div>
    </div>
  );
}
