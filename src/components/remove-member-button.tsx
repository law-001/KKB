"use client";

import { useState, useTransition } from "react";
import { removeMember } from "@/server/groups";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconX } from "@/components/ui";

export function RemoveMemberButton({
  groupId,
  memberId,
  memberName,
}: {
  groupId: string;
  memberId: string;
  memberName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove ${memberName}`}
        className="ml-1.5 shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:bg-neg-soft hover:text-neg"
      >
        <IconX className="size-3.5" />
      </button>
      <ConfirmDialog
        open={open}
        title={`Remove ${memberName}?`}
        description="They lose access to this group. Their expense and settlement history stays on the ledger — they must be settled up first."
        confirmLabel="Remove"
        pendingLabel="Removing…"
        pending={pending}
        error={error}
        onCancel={() => {
          setError(null);
          setOpen(false);
        }}
        onConfirm={() =>
          startTransition(async () => {
            const result = await removeMember(groupId, memberId);
            if (result?.error) setError(result.error);
            else setOpen(false);
          })
        }
      />
    </>
  );
}
