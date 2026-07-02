import Link from "next/link";
import { getAllGroups } from "@/lib/db/queries";
import { CreateGroupForm } from "@/components/create-group-form";

// Reads the DB on every request; without this the page would be prerendered
// once at build time (no cookies/params make it statically inferable).
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const groups = getAllGroups();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Groups</h1>
      <CreateGroupForm />
      {groups.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No groups yet — create one above with everyone&rsquo;s names.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white">
          {groups.map((g) => (
            <li key={g.id}>
              <Link
                href={`/groups/${g.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50"
              >
                <span className="font-medium">{g.name}</span>
                <span className="text-sm text-zinc-500">{g.currency}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
