"use client";

import { useActionState } from "react";
import { setDisplayName, type ProfileFormState } from "@/server/auth-actions";

export function WelcomeForm({
  next,
  defaultName,
}: {
  next: string;
  defaultName: string;
}) {
  const action = setDisplayName.bind(null, next);
  const [state, formAction, pending] = useActionState<ProfileFormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="card space-y-4 p-4 sm:p-5">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Your name</span>
        <input
          name="name"
          required
          maxLength={80}
          autoFocus
          defaultValue={defaultName}
          placeholder="Alex"
          className="field"
        />
        <span className="mt-1 block text-xs text-ink-faint">
          This is what shows up on every receipt and balance.
        </span>
      </label>
      <button
        disabled={pending}
        className="btn btn-primary min-h-11 w-full px-4 text-sm"
      >
        {pending ? "Saving…" : "Continue"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      )}
    </form>
  );
}
