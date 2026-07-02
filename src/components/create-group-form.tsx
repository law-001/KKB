"use client";

import { useActionState } from "react";
import { createGroup, type FormState } from "@/server/groups";
import { SUPPORTED_CURRENCIES } from "@/lib/ledger/money";

export function CreateGroupForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createGroup,
    {},
  );
  return (
    <form
      action={formAction}
      className="flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-white p-4"
    >
      <label className="min-w-40 flex-1 text-sm">
        <span className="mb-1 block font-medium">New group</span>
        <input
          name="name"
          required
          maxLength={80}
          placeholder="Friday Dinner Crew"
          className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Currency</span>
        <select
          name="currency"
          defaultValue="PHP"
          className="rounded-md border border-zinc-300 bg-white px-2 py-2 text-sm"
        >
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <button
        disabled={pending}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Create
      </button>
      {state.error && (
        <p className="w-full text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}
