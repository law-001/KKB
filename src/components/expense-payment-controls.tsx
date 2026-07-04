"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  recordExpensePayment,
  unmarkExpensePayments,
} from "@/server/settlements";
import { formatCents } from "@/lib/ledger/money";
import { IconCheck } from "@/components/ui";

/**
 * Per-person payment state on an expense. The checkbox is the whole story:
 * checked = their share is paid (recorded as a settlement to the payer),
 * unchecked = not yet. Overpayments (bayad > share at creation) leave sukli,
 * settled with its own link.
 */
export function ExpensePaymentControls({
  expenseId,
  userId,
  name,
  currency,
  shareCents,
  paidCents,
  sukliGivenCents,
  active,
}: {
  expenseId: string;
  userId: string;
  name: string;
  currency: string;
  shareCents: number;
  paidCents: number;
  sukliGivenCents: number;
  active: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const remaining = Math.max(0, shareCents - paidCents);
  const sukliDue = Math.max(0, paidCents - shareCents - sukliGivenCents);
  const isPaid = remaining === 0 && paidCents > 0;

  const run = (fn: () => Promise<{ ok?: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const result = await fn();
      if (result.error) setError(result.error);
      else router.refresh();
    });

  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      <label
        className={`inline-flex min-h-6 items-center gap-1.5 ${
          active ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="checkbox">
          <input
            type="checkbox"
            checked={isPaid}
            disabled={pending || !active}
            onChange={() =>
              run(() =>
                isPaid
                  ? unmarkExpensePayments(expenseId, userId)
                  : recordExpensePayment(expenseId, {
                      userId,
                      amountCents: remaining > 0 ? remaining : shareCents,
                      direction: "payment",
                    }),
              )
            }
            aria-label={`${name} has paid their share`}
            className="peer absolute inset-0 size-full cursor-pointer appearance-none disabled:cursor-not-allowed"
          />
          <IconCheck className="pointer-events-none size-3 scale-0 text-cream transition-transform duration-150 peer-checked:scale-100" />
        </span>
        <span
          className={`font-mono uppercase tracking-wider ${
            isPaid ? "text-pos" : "text-neg"
          }`}
        >
          {pending ? "saving…" : isPaid ? "paid" : "unpaid"}
        </span>
      </label>

      {paidCents > 0 && remaining > 0 && (
        <span className="font-mono tabular-nums text-warn">
          kulang {formatCents(remaining, currency)}
        </span>
      )}

      {sukliDue > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <span className="font-mono tabular-nums text-warn">
            sukli {formatCents(sukliDue, currency)} due
          </span>
          {active && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(() =>
                  recordExpensePayment(expenseId, {
                    userId,
                    amountCents: sukliDue,
                    direction: "sukli",
                  }),
                )
              }
              className="font-medium text-accent-deep underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              Sukli handed back
            </button>
          )}
        </span>
      )}

      {isPaid && paidCents > shareCents && sukliDue === 0 && (
        <span className="font-mono tabular-nums text-ink-faint">
          sukli returned
        </span>
      )}

      {error && (
        <span role="alert" className="text-neg">
          {error}
        </span>
      )}
    </div>
  );
}
