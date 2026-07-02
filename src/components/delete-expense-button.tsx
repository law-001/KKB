"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteExpense } from "@/server/expenses";

export function DeleteExpenseButton({
  expenseId,
  groupId,
  hasSettlements,
}: {
  expenseId: string;
  groupId: string;
  hasSettlements: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-red-700">
        {hasSettlements
          ? "People have already settled against this group's balances — deleting will shift them. Sure?"
          : "Delete this expense? Balances will recompute."}
      </span>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteExpense(expenseId);
            if (result.error) setError(result.error);
            else {
              router.push(`/groups/${groupId}`);
              router.refresh();
            }
          })
        }
        className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
      >
        Yes, delete
      </button>
      <button
        onClick={() => setArmed(false)}
        className="rounded-md border border-zinc-300 px-3 py-1.5 text-zinc-600 hover:bg-zinc-100"
      >
        Cancel
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </span>
  );
}
