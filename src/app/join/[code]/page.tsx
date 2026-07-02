import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getGroupByInviteCode, getGroupMembers } from "@/lib/db/queries";
import { joinGroup } from "@/server/groups";

/** The preview is public; joining is auth-gated. */
export default async function JoinPage(props: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await props.params;
  const group = getGroupByInviteCode(code);
  if (!group) notFound();

  const user = await getCurrentUser();
  const members = getGroupMembers(group.id);
  const alreadyIn = user ? members.some((m) => m.id === user.id) : false;

  return (
    <div className="mx-auto max-w-md py-8 text-center">
      <p className="text-sm text-zinc-500">You&rsquo;ve been invited to</p>
      <h1 className="mt-1 text-3xl font-bold">{group.name}</h1>
      <p className="mt-2 text-sm text-zinc-500">
        {members.length} member{members.length === 1 ? "" : "s"} ·{" "}
        {group.currency}
      </p>
      <div className="mt-6">
        {alreadyIn ? (
          <Link
            href={`/groups/${group.id}`}
            className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
          >
            You&rsquo;re already in — open group
          </Link>
        ) : user ? (
          <form action={joinGroup.bind(null, code)}>
            <button className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700">
              Join {group.name}
            </button>
          </form>
        ) : (
          <div className="space-y-2">
            <Link
              href="/login"
              className="inline-block rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
            >
              Sign in to join
            </Link>
            <p className="text-sm text-zinc-500">
              New here?{" "}
              <Link href="/register" className="text-emerald-600 hover:underline">
                Create an account
              </Link>{" "}
              then open this link again.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
