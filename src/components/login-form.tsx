"use client";

import { useActionState } from "react";
import { signInWithMagicLink, type AuthFormState } from "@/server/auth-actions";

export function LoginForm({ next }: { next: string }) {
  const action = signInWithMagicLink.bind(null, next);
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    action,
    {},
  );

  if (state.sent) {
    return (
      <div className="card space-y-2 p-5 text-sm">
        <p className="font-medium">Check your email</p>
        <p className="text-ink-faint">
          We sent a sign-in link. Open it on this device to continue.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="card space-y-4 p-4 sm:p-5">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Email</span>
        <input
          name="email"
          type="email"
          required
          autoFocus
          placeholder="you@example.com"
          className="field"
        />
      </label>
      <button
        disabled={pending}
        className="btn btn-primary min-h-11 w-full px-4 text-sm"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      )}
    </form>
  );
}
