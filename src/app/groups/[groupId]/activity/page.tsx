import Link from "next/link";
import { notFound } from "next/navigation";
import { getActivityFeed, getGroup } from "@/lib/db/queries";
import { formatCents } from "@/lib/ledger/money";

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
    default:
      return `${actor}: ${verb}`;
  }
}

export default async function ActivityPage(props: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await props.params;
  const group = getGroup(groupId);
  if (!group) notFound();

  const feed = getActivityFeed(groupId);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity — {group.name}</h1>
      {feed.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing has happened yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {feed.map((item) => (
            <li key={item.id} className="px-4 py-2.5 text-sm">
              <p>{describe(item.verb, item.actorName, item.payload, group.currency)}</p>
              <p className="text-xs text-zinc-400">
                {item.createdAt.toLocaleString()}
              </p>
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
