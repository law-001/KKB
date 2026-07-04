import { notFound, redirect } from "next/navigation";
import { getGroupByInviteCode, isMember } from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/auth";
import { joinGroup } from "@/server/groups";
import { PageHeader } from "@/components/ui";

export default async function JoinPage(props: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await props.params;
  const group = await getGroupByInviteCode(code);
  if (!group) notFound();

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
  if (await isMember(group.id, user.id)) redirect(`/groups/${group.id}`);

  const action = joinGroup.bind(null, code);

  return (
    <div className="mx-auto max-w-sm space-y-8">
      <div className="rise">
        <PageHeader eyebrow="Invite" title={group.name} />
      </div>
      <form action={action} className="card rise rise-1 space-y-4 p-4 sm:p-5">
        <p className="text-sm text-ink-soft">
          Join as{" "}
          <span className="font-medium text-ink">{user.name}</span>? You&rsquo;ll
          see every expense, settlement, and balance in this group.
        </p>
        <button className="btn btn-primary min-h-11 w-full px-4 text-sm">
          Join {group.name}
        </button>
      </form>
    </div>
  );
}
