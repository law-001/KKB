"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteExpense } from "@/server/expenses";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-danger min-h-10 px-4 text-sm"
      >
        Delete
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this expense?"
        description={
          hasSettlements
            ? "People have already settled against this group's balances — deleting will shift them."
            : "Balances will recompute once it's gone. There is no undo."
        }
        confirmLabel="Yes, delete"
        pendingLabel="Deleting…"
        pending={pending}
        error={error}
        onCancel={() => {
          setError(null);
          setOpen(false);
        }}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteExpense(expenseId);
            if (result.error) setError(result.error);
            else {
              router.push(`/groups/${groupId}`);
              router.refresh();
            }
          })
        }
      />
    </>
  );
}
