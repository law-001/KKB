import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { register } from "@/server/auth-actions";
import { AuthForm } from "@/components/auth-form";

export default async function RegisterPage() {
  if (await getCurrentUser()) redirect("/groups");
  return (
    <div className="mx-auto max-w-sm py-8">
      <h1 className="mb-6 text-2xl font-bold">Create your account</h1>
      <AuthForm mode="register" action={register} />
      <p className="mt-4 text-sm text-zinc-500">
        Already have an account?{" "}
        <Link href="/login" className="text-emerald-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
