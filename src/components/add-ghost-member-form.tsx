"use client";

import { useActionState } from "react";
import { addGhostMember, type FormState } from "@/server/groups";

/** Admin-only: add someone by name, no invite or signup required. */
export function AddGhostMemberForm({ groupId }: { groupId: string }) {
  const action = addGhostMember.bind(null, groupId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );

  return (
    <form action={formAction} className="space-y-2">
      <p className="text-sm font-medium">Add without an account</p>
      <div className="flex items-center gap-2">
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Name"
          className="field min-w-0 flex-1 text-sm"
        />
        <button
          disabled={pending}
          className="btn btn-ghost min-h-11 shrink-0 px-4 text-sm"
        >
          {pending ? "Adding…" : "Add"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="text-xs text-neg">
          {state.error}
        </p>
      )}
      <p className="text-xs text-ink-faint">
        For someone who won&rsquo;t sign up — they show up in splits and
        balances like anyone else.
      </p>
    </form>
  );
}
