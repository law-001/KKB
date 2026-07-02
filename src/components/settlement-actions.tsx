"use client";

import { useState, useTransition } from "react";
import { confirmSettlement, rejectSettlement } from "@/server/settlements";

export function SettlementActions({ settlementId }: { settlementId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: (id: string) => Promise<{ error?: string }>) => {
    startTransition(async () => {
      const result = await fn(settlementId);
      setError(result.error ?? null);
    });
  };

  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() => run(confirmSettlement)}
        className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Confirm
      </button>
      <button
        disabled={pending}
        onClick={() => run(rejectSettlement)}
        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
      >
        Reject
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
