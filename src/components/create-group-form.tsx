"use client";

import { useActionState } from "react";
import { createGroup, type FormState } from "@/server/groups";
import { SUPPORTED_CURRENCIES } from "@/lib/ledger/money";
import { Select } from "@/components/ui";

export function CreateGroupForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createGroup,
    {},
  );
  return (
    <form action={formAction} className="card space-y-4 p-4 sm:p-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Group name</span>
          <input
            name="name"
            required
            maxLength={80}
            placeholder="Friday Dinner Crew"
            className="field"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Currency</span>
          <Select name="currency" defaultValue="PHP" className="font-mono">
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </label>
      </div>
      <p className="text-xs text-ink-faint">
        You&rsquo;ll be the first member. Invite everyone else with a link once the
        group is created.
      </p>
      <button
        disabled={pending}
        className="btn btn-primary min-h-11 w-full px-4 text-sm sm:w-auto"
      >
        {pending ? "Creating…" : "Create group"}
      </button>
      {state.error && (
        <p role="alert" className="text-sm text-neg">
          {state.error}
        </p>
      )}
    </form>
  );
}
