"use client";

import { useActionState } from "react";
import { addGhostMember, type FormState } from "@/server/groups";

export function GhostMemberForm({ groupId }: { groupId: string }) {
  const action = addGhostMember.bind(null, groupId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    action,
    {},
  );
  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        name="name"
        required
        maxLength={80}
        placeholder="Add member by name (no account needed)"
        className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-emerald-500 focus:outline-none"
      />
      <button
        disabled={pending}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 disabled:opacity-50"
      >
        Add
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
