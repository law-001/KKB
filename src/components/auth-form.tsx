"use client";

import { useActionState } from "react";
import type { AuthFormState } from "@/server/auth-actions";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none";

export function AuthForm({
  mode,
  action,
}: {
  mode: "login" | "register";
  action: (prev: AuthFormState, formData: FormData) => Promise<AuthFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4">
      {mode === "register" && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name</span>
          <input name="name" required maxLength={80} className={inputClass} />
        </label>
      )}
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input name="email" type="email" required className={inputClass} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Password</span>
        <input
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 8 : 1}
          className={inputClass}
        />
      </label>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button
        disabled={pending}
        className="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {pending ? "…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}
