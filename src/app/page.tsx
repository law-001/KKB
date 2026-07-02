import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/groups");

  return (
    <div className="py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        Split<span className="text-emerald-600">Weird</span>
      </h1>
      <p className="mx-auto mt-4 max-w-md text-lg text-zinc-600">
        Bill splitting for the messy reality of group spending: uneven splits
        (&ldquo;I only had a salad&rdquo;), old debts (&ldquo;you owe me from
        three dinners ago&rdquo;), and running tabs between the same friends
        over time.
      </p>
      <div className="mt-8 flex justify-center gap-3">
        <Link
          href="/register"
          className="rounded-md bg-emerald-600 px-5 py-2.5 font-medium text-white hover:bg-emerald-700"
        >
          Get started
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-zinc-300 px-5 py-2.5 font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
