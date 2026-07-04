import { notFound } from "next/navigation";
import { getActivityFeed, getGroup } from "@/lib/db/queries";
import { requireGroupMember } from "@/lib/auth";
import { formatCents } from "@/lib/ledger/money";
import { Amount, BackLink, Dots, EmptyState, PageHeader } from "@/components/ui";

function describe(
  verb: string,
  actor: string,
  payload: Record<string, unknown> | null,
  currency: string,
): string {
  const p = payload ?? {};
  const amount =
    typeof p.totalCents === "number"
      ? formatCents(p.totalCents, currency)
      : typeof p.amountCents === "number"
        ? formatCents(p.amountCents, currency)
        : "";
  switch (verb) {
    case "group.created":
      return `${actor} created the group`;
    case "member.joined":
      return `${p.memberName ?? actor} joined the group`;
    case "member.added":
    case "member.ghost_added": // legacy verb from the accounts era
      return `${p.memberName ?? actor} was added to the group`;
    case "member.removed":
      return `${actor} removed ${p.memberName} from the group`;
    case "expense.created":
      return `${actor} added "${p.description}" — ${amount} (${p.method})`;
    case "expense.edited":
      return `${actor} edited "${p.description}" — now ${amount}`;
    case "expense.deleted":
      return `${actor} deleted "${p.description}" (${amount})`;
    case "settlement.recorded":
      return `${p.fromName} paid ${p.toName} ${amount}${p.method ? ` via ${p.method}` : ""} — awaiting confirmation`;
    case "settlement.confirmed":
      return p.fromName
        ? `${p.fromName} paid ${p.toName} ${amount}${p.method ? ` via ${p.method}` : ""}`
        : `${actor} confirmed a payment of ${amount}`;
    case "settlement.rejected":
      return `${actor} rejected a payment of ${amount}`;
    case "payment.unmarked":
      return `${p.memberName}'s payment for "${p.description}" was marked unpaid`;
    default:
      return `${actor}: ${verb}`;
  }
}

export default async function ActivityPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  await requireGroupMember(groupId);
  const [group, feed] = await Promise.all([
    getGroup(groupId),
    getActivityFeed(groupId),
  ]);
  if (!group) notFound();

  // One section per day (feed arrives newest first). The day total sums the
  // expenses added that day, so a dinner night reads like one receipt.
  const days: { key: string; date: Date; expenseCents: number; items: typeof feed }[] = [];
  for (const item of feed) {
    const key = item.createdAt.toDateString();
    let day = days[days.length - 1];
    if (!day || day.key !== key) {
      day = { key, date: item.createdAt, expenseCents: 0, items: [] };
      days.push(day);
    }
    const total = item.verb === "expense.created" ? item.payload?.totalCents : null;
    if (typeof total === "number") day.expenseCents += total;
    day.items.push(item);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="rise">
        <PageHeader eyebrow={group.name} title="Activity" />
        <p className="mt-2 text-sm text-ink-faint">
          The append-only audit trail. Nothing here is ever rewritten.
        </p>
      </div>

      {feed.length === 0 ? (
        <div className="rise rise-1">
          <EmptyState title="Nothing has happened yet" />
        </div>
      ) : (
        <div className="rise rise-1 space-y-6">
          {days.map((day) => (
            <section key={day.key}>
              <h2 className="flex items-baseline border-b border-dashed border-line pb-2 microlabel">
                <span>
                  {day.date.toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                <Dots />
                {day.expenseCents > 0 ? (
                  <span className="inline-flex items-baseline gap-1.5">
                    <span className="normal-case tracking-normal">expenses</span>
                    <Amount cents={day.expenseCents} currency={group.currency} />
                  </span>
                ) : (
                  <span className="text-line">—</span>
                )}
              </h2>
              <ul className="divide-y divide-line-soft">
                {day.items.map((item) => (
                  <li key={item.id} className="py-3">
                    <p className="text-sm leading-relaxed">
                      {describe(item.verb, item.actorName, item.payload, group.currency)}
                    </p>
                    <p className="microlabel mt-1 normal-case tracking-normal">
                      {item.createdAt.toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
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
