"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSettlement } from "@/server/settlements";
import { formatCents, parseAmountToCents } from "@/lib/ledger/money";
import type { MemberOption } from "@/components/expense-form";
import { IconCheck, Select } from "@/components/ui";

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

  if (done)
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-pos">
        <IconCheck className="size-3.5" />
        Recorded
      </span>
    );
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
        className="btn btn-stamp min-h-9 px-3 text-xs"
      >
        {pending ? "Recording…" : "Record this payment"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-neg">
          {error}
        </span>
      )}
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
  const overpaying = amountCents !== null && owed >= 0 && amountCents > owed;

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
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <label className="block min-w-0 text-sm">
          <span className="microlabel mb-1 block">From</span>
          <Select value={fromUser} onChange={(e) => setFromUser(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
        <span className="pb-2.5 text-sm text-ink-faint">paid</span>
        <label className="block min-w-0 text-sm">
          <span className="microlabel mb-1 block">To</span>
          <Select value={toUser} onChange={(e) => setToUser(e.target.value)}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2 sm:grid-cols-[10rem_1fr_auto]">
        <label className="block min-w-0 text-sm">
          <span className="microlabel mb-1 block">Amount · {currency}</span>
          <input
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className="field font-mono tabular-nums"
          />
        </label>
        <label className="block min-w-0 text-sm">
          <span className="microlabel mb-1 block">Method · optional</span>
          <input
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="GCash, cash…"
            maxLength={40}
            className="field"
          />
        </label>
        <button
          disabled={pending}
          className="btn btn-primary col-span-2 min-h-11 px-5 text-sm sm:col-span-1"
        >
          {pending ? "Recording…" : "Record"}
        </button>
      </div>
      {overpaying && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-xs leading-relaxed text-warn">
          Heads up: that&rsquo;s more than the {formatCents(owed, currency)}{" "}
          currently owed on this pair, so the balance will flip the other way.
          That&rsquo;s allowed.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <p className="text-xs text-ink-faint">
        Recorded immediately. Partial amounts are fine, and everything shows
        up in the activity feed.
      </p>
    </form>
  );
}
