"use client";

import { useState, useTransition } from "react";
import { deleteGroup } from "@/server/groups";
import { ConfirmDialog } from "@/components/confirm-dialog";

export function DeleteGroupButton({ groupId }: { groupId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-danger min-h-10 px-4 text-sm"
      >
        Delete group
      </button>
      <ConfirmDialog
        open={open}
        title="Delete this group?"
        description="This erases the whole ledger — every expense, settlement, and member. There is no undo."
        confirmLabel="Yes, delete everything"
        pendingLabel="Deleting…"
        pending={pending}
        error={error}
        onCancel={() => {
          setError(null);
          setOpen(false);
        }}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteGroup(groupId);
            if (result?.error) setError(result.error);
          })
        }
      />
    </>
  );
}
