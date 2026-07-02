import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getUserGroups } from "@/lib/db/queries";
import { CreateGroupForm } from "@/components/create-group-form";

export default async function GroupsPage(props: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUser();
  const { error } = await props.searchParams;
  const groups = getUserGroups(user.id);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Your groups</h1>
      {error === "invalid-invite" && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          That invite link isn&rsquo;t valid.
        </p>
      )}
      <CreateGroupForm />
      {groups.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No groups yet — create one above, or ask a friend for an invite link.
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
