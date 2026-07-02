import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { login } from "@/server/auth-actions";
import { AuthForm } from "@/components/auth-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/groups");
  return (
    <div className="mx-auto max-w-sm py-8">
      <h1 className="mb-6 text-2xl font-bold">Sign in</h1>
      <AuthForm mode="login" action={login} />
      <p className="mt-4 text-sm text-zinc-500">
        No account?{" "}
        <Link href="/register" className="text-emerald-600 hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
