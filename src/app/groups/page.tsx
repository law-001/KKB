import Link from "next/link";
import { getGroupsForUser } from "@/lib/db/queries";
import { requireUser } from "@/lib/auth";
import { CreateGroupForm } from "@/components/create-group-form";
import { IconChevronRight, IconPlus, PageHeader } from "@/components/ui";

// Reads the DB on every request; without this the page would be prerendered
// once at build time (no cookies/params make it statically inferable).
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const user = await requireUser();
  const groups = await getGroupsForUser(user.id);

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div className="rise">
        <PageHeader eyebrow="Shared ledgers" title="Groups" />
      </div>

      {groups.length === 0 ? (
        <section className="rise rise-1 space-y-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            No groups yet. Start one, then send the invite link to the
            barkada — that&rsquo;s how everyone else gets in.
          </p>
          <CreateGroupForm />
        </section>
      ) : (
        <>
          <ul className="rise rise-1 divide-y divide-line-soft overflow-hidden rounded-xl border border-line bg-cream">
            {groups.map((g) => (
              <li key={g.id}>
                <Link
                  href={`/groups/${g.id}`}
                  className="group flex min-h-14 items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-paper"
                >
                  <span className="truncate font-medium">{g.name}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="microlabel">{g.currency}</span>
                    <IconChevronRight className="size-4 text-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-accent-deep" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <details className="rise rise-2 group">
            <summary className="btn btn-ghost min-h-10 cursor-pointer list-none px-4 text-sm [&::-webkit-details-marker]:hidden">
              <IconPlus className="size-4 transition-transform group-open:rotate-45" />
              New group
            </summary>
            <div className="mt-4">
              <CreateGroupForm />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
