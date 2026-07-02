"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSettlement } from "@/server/settlements";
import { formatCents, parseAmountToCents } from "@/lib/ledger/money";
import type { MemberOption } from "@/components/expense-form";

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none";

/** One-tap "record this payment" for a suggested transfer. */
export function RecordTransferButton({
  groupId,
  fromUser,
  toUser,
  amountCents,
}: {
  groupId: string;
  fromUser: string;
  toUser: string;
  amountCents: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) return <span className="text-xs text-emerald-600">Recorded ✓</span>;
  return (
    <span className="flex items-center gap-2">
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createSettlement(groupId, {
              fromUser,
              toUser,
              amountCents,
            });
            if (result.error) setError(result.error);
            else {
              setDone(true);
              router.refresh();
            }
          })
        }
        className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        Record this payment
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}

/** Manual settlement: any member pays any other member. */
export function ManualSettlementForm({
  groupId,
  currency,
  members,
  overpayWarnings,
}: {
  groupId: string;
  currency: string;
  members: MemberOption[];
  /** debtor|creditor -> owed cents, to warn (not block) on overpayment */
  overpayWarnings: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [fromUser, setFromUser] = useState(members[0]?.id ?? "");
  const [toUser, setToUser] = useState(members[1]?.id ?? members[0]?.id ?? "");
  const [amountStr, setAmountStr] = useState("");
  const [method, setMethod] = useState("");

  const amountCents = parseAmountToCents(amountStr, currency);
  const owed = overpayWarnings[`${fromUser}|${toUser}`] ?? 0;
  const overpaying =
    amountCents !== null && owed >= 0 && amountCents > owed;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (amountCents === null || amountCents <= 0) {
          setError("Enter a valid amount");
          return;
        }
        startTransition(async () => {
          const result = await createSettlement(groupId, {
            fromUser,
            toUser,
            amountCents,
            method: method.trim() || undefined,
          });
          if (result.error) setError(result.error);
          else {
            setAmountStr("");
            setError(null);
            router.refresh();
          }
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={fromUser} onChange={(e) => setFromUser(e.target.value)} className={inputClass}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="text-zinc-500">paid</span>
        <select value={toUser} onChange={(e) => setToUser(e.target.value)} className={inputClass}>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          inputMode="decimal"
          placeholder={`amount (${currency})`}
          className={`${inputClass} w-32`}
        />
        <input
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          placeholder="GCash, cash… (optional)"
          maxLength={40}
          className={`${inputClass} w-40`}
        />
        <button
          disabled={pending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Record
        </button>
      </div>
      {overpaying && (
        <p className="text-xs text-amber-600">
          Heads up: that&rsquo;s more than the{" "}
          {formatCents(owed, currency)} currently owed on this pair — the
          balance will flip the other way. That&rsquo;s allowed.
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-zinc-400">
        Recorded immediately — partial amounts are fine, and everything shows
        up in the activity feed.
      </p>
    </form>
  );
}
