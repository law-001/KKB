"use client";

import { useState } from "react";
import { IconCheck } from "@/components/ui";

/** Shows the group's invite link with a copy button — the only way to add members now. */
export function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/join/${code}` : "";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Invite link</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="field min-w-0 flex-1 font-mono text-xs"
          aria-label="Invite link"
        />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="btn btn-ghost min-h-11 shrink-0 px-4 text-sm"
        >
          {copied ? <IconCheck className="size-4" /> : null}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        Anyone with this link can join and see the full ledger.
      </p>
    </div>
  );
}
