"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  computeShares,
  SplitError,
  type SplitInput,
} from "@/lib/ledger/split";
import { formatCents, parseAmountToCents } from "@/lib/ledger/money";
import type { ExpensePayload } from "@/lib/expense-payload";
import type { ScanResult } from "@/lib/receipt-scan";
import { ReceiptScanButton } from "@/components/receipt-scan";
import { IconCheck, IconMinus, IconPlus, IconX, Select } from "@/components/ui";

export interface MemberOption {
  id: string;
  name: string;
}

interface PayerRow {
  userId: string;
  amountStr: string;
}

interface ItemRow {
  label: string;
  /** Price of a single unit; multiplied by qty for the line total. */
  amountStr: string;
  qty: number;
  /** userId -> weight (0 = not consuming) */
  weights: Record<string, number>;
}

interface OverheadRow {
  kind: "tax" | "tip" | "service" | "discount";
  label: string;
  amountStr: string; // entered positive; discounts are negated on submit
  distribution: "proportional" | "even";
}

const METHODS = [
  { id: "itemized", label: "Itemized" },
  { id: "even", label: "Even" },
  { id: "exact", label: "Exact" },
  { id: "shares", label: "Shares" },
  { id: "percent", label: "Percent" },
  { id: "adjustment", label: "IOU" },
] as const;

type Method = (typeof METHODS)[number]["id"];

/** Percent string ("33.33") -> integer basis points (3333), or null. */
function parsePercentToBp(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return parseInt(whole, 10) * 100 + (frac ? parseInt(frac.padEnd(2, "0"), 10) : 0);
}

/** Small icon-only remove button, 44px hit area via padding. */
function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-m-1 shrink-0 rounded-lg p-2 text-ink-faint transition-colors hover:bg-neg-soft hover:text-neg"
    >
      <IconX className="size-4" />
    </button>
  );
}

export function ExpenseForm({
  groupId,
  currency,
  members,
  defaultPayerId,
  initial,
  submitAction,
  scanAction,
}: {
  groupId: string;
  currency: string;
  members: MemberOption[];
  defaultPayerId: string;
  initial?: {
    description: string;
    totalCents: number;
    paidAt: string;
    notes?: string;
    payers: { userId: string; amountCents: number }[];
    split: SplitInput | null;
  };
  submitAction: (payload: ExpensePayload) => Promise<{ ok?: boolean; error?: string }>;
  /** When set (server has a scanner key), the itemized split offers photo scan. */
  scanAction?: (input: unknown) => Promise<{ result?: ScanResult; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const factor = currency === "JPY" || currency === "KRW" ? 1 : 100;
  const toAmountStr = (cents: number) => (cents / factor).toString();

  // ── Base fields ────────────────────────────────────────────────────────
  const [description, setDescription] = useState(initial?.description ?? "");
  const [totalStr, setTotalStr] = useState(
    initial ? toAmountStr(initial.totalCents) : "",
  );
  const [paidAt, setPaidAt] = useState(
    initial?.paidAt ?? new Date().toISOString().slice(0, 10),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");

  // ── Payers ─────────────────────────────────────────────────────────────
  const [payers, setPayers] = useState<PayerRow[]>(
    initial?.payers.map((p) => ({
      userId: p.userId,
      amountStr: toAmountStr(p.amountCents),
    })) ?? [{ userId: defaultPayerId, amountStr: "" }],
  );
  // Off = true KKB: nobody fronted the bill, everyone paid their own share.
  // Default off — most of the time no single friend covers the whole table.
  const [someonePaid, setSomeonePaid] = useState<boolean>(() => {
    if (!initial) return false;
    if (!initial.split) return true;
    try {
      // An expense saved in KKB mode has payers identical to its shares.
      const shares = computeShares(initial.totalCents, initial.split);
      const nonZero = [...shares.values()].filter((c) => c > 0).length;
      const paidOwn =
        initial.payers.length === nonZero &&
        initial.payers.every((p) => shares.get(p.userId) === p.amountCents);
      return !paidOwn;
    } catch {
      return true;
    }
  });

  // ── Split method state ─────────────────────────────────────────────────
  const initialSplit = initial?.split ?? null;
  // Itemized is the default: the receipt is what's in front of you.
  const [method, setMethod] = useState<Method>(
    initialSplit?.method ?? "itemized",
  );

  const [evenParticipants, setEvenParticipants] = useState<Set<string>>(
    () =>
      new Set(
        initialSplit?.method === "even"
          ? initialSplit.participants
          : members.map((m) => m.id),
      ),
  );
  const [exactAmounts, setExactAmounts] = useState<Record<string, string>>(() =>
    initialSplit?.method === "exact"
      ? Object.fromEntries(
          initialSplit.allocations.map((a) => [a.userId, toAmountStr(a.amountCents)]),
        )
      : {},
  );
  const [shareCounts, setShareCounts] = useState<Record<string, string>>(() =>
    initialSplit?.method === "shares"
      ? Object.fromEntries(
          initialSplit.allocations.map((a) => [a.userId, String(a.shares)]),
        )
      : Object.fromEntries(members.map((m) => [m.id, "1"])),
  );
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    initialSplit?.method === "percent"
      ? Object.fromEntries(
          initialSplit.allocations.map((a) => [
            a.userId,
            (a.basisPoints / 100).toString(),
          ]),
        )
      : {},
  );
  const [owerId, setOwerId] = useState<string>(
    initialSplit?.method === "adjustment"
      ? initialSplit.owerId
      : (members.find((m) => m.id !== defaultPayerId)?.id ?? members[0]?.id ?? ""),
  );

  // "Bayad" — cash each person hands over at the table. Sukli = bayad − share.
  // On create it's recorded as expense-linked settlements to the payer (or,
  // in KKB mode, to whoever holds the cash pile).
  const [bayad, setBayad] = useState<Record<string, string>>({});

  const allWeightsOn = () =>
    Object.fromEntries(members.map((m) => [m.id, 1]));
  const [items, setItems] = useState<ItemRow[]>(() =>
    initialSplit?.method === "itemized"
      ? initialSplit.items.map((i) => ({
          label: i.label,
          // Existing expenses only ever stored a line total, so it loads
          // back as qty 1 — mathematically identical to "price each".
          amountStr: toAmountStr(i.amountCents),
          qty: 1,
          weights: {
            ...Object.fromEntries(members.map((m) => [m.id, 0])),
            ...Object.fromEntries(i.consumers.map((c) => [c.userId, c.weight > 0 ? 1 : 0])),
          },
        }))
      : [{ label: "", amountStr: "", qty: 1, weights: allWeightsOn() }],
  );
  const [overheads, setOverheads] = useState<OverheadRow[]>(() =>
    initialSplit?.method === "itemized"
      ? initialSplit.overheads.map((o) => ({
          kind: o.kind,
          label: o.label,
          amountStr: toAmountStr(Math.abs(o.amountCents)),
          distribution: o.distribution,
        }))
      : [],
  );

  // Grand total printed on a scanned receipt, kept so we can warn when the
  // extracted lines don't add up to what the paper says.
  const [scannedTotalCents, setScannedTotalCents] = useState<number | null>(null);

  /** Prefill from a receipt photo. Appends, so typed rows are never lost. */
  const applyScan = (r: ScanResult) => {
    const blank = (row: ItemRow) =>
      row.label.trim() === "" && row.amountStr.trim() === "";
    setItems([
      ...items.filter((row) => !blank(row)),
      ...r.items.map((i) => ({
        label: i.label,
        amountStr: toAmountStr(i.unitCents),
        qty: i.qty,
        weights: allWeightsOn(),
      })),
    ]);
    if (r.overheads.length > 0) {
      setOverheads([
        ...overheads.filter((o) => o.amountStr.trim() !== ""),
        ...r.overheads.map((o) => ({
          kind: o.kind,
          label: o.label,
          amountStr: toAmountStr(o.amountCents),
          distribution: "proportional" as const,
        })),
      ]);
    }
    if (r.merchant && description.trim() === "") setDescription(r.merchant);
    setScannedTotalCents(r.totalCents ?? null);
  };

  // ── Derived: totals, split input, live preview ────────────────────────
  // amountStr is the price of one unit; the line total is unit × qty.
  const itemizedItemCents = items.map((i) => {
    const unit = parseAmountToCents(i.amountStr, currency);
    return unit === null ? null : unit * i.qty;
  });
  const itemizedOverheadCents = overheads.map((o) => {
    const v = parseAmountToCents(o.amountStr, currency);
    if (v === null) return null;
    return o.kind === "discount" ? -v : v;
  });
  const itemizedTotal =
    method === "itemized" &&
    itemizedItemCents.every((v) => v !== null && v > 0) &&
    itemizedOverheadCents.every((v) => v !== null)
      ? itemizedItemCents.reduce<number>((s, v) => s + (v ?? 0), 0) +
        itemizedOverheadCents.reduce<number>((s, v) => s + (v ?? 0), 0)
      : null;

  const totalCents =
    method === "itemized" ? itemizedTotal : parseAmountToCents(totalStr, currency);

  const split: SplitInput | { error: string } = useMemo(() => {
    try {
      switch (method) {
        case "even": {
          const participants = members
            .filter((m) => evenParticipants.has(m.id))
            .map((m) => m.id);
          if (participants.length === 0) return { error: "Pick at least one person" };
          return { method, participants };
        }
        case "exact": {
          const allocations = members
            .filter((m) => (exactAmounts[m.id] ?? "").trim() !== "")
            .map((m) => ({
              userId: m.id,
              amountCents: parseAmountToCents(exactAmounts[m.id], currency) ?? NaN,
            }));
          if (allocations.length === 0) return { error: "Enter at least one amount" };
          if (allocations.some((a) => !Number.isSafeInteger(a.amountCents) || a.amountCents <= 0))
            return { error: "Amounts must be positive numbers" };
          return { method, allocations };
        }
        case "shares": {
          const allocations = members
            .map((m) => ({ userId: m.id, shares: parseInt(shareCounts[m.id] || "0", 10) }))
            .filter((a) => Number.isInteger(a.shares) && a.shares > 0);
          if (allocations.length === 0) return { error: "Give someone at least 1 share" };
          return { method, allocations };
        }
        case "percent": {
          const allocations = members
            .filter((m) => (percents[m.id] ?? "").trim() !== "")
            .map((m) => ({
              userId: m.id,
              basisPoints: parsePercentToBp(percents[m.id]) ?? NaN,
            }));
          if (allocations.length === 0) return { error: "Enter percentages" };
          if (allocations.some((a) => !Number.isSafeInteger(a.basisPoints) || a.basisPoints <= 0))
            return { error: "Percentages must be positive numbers" };
          return { method, allocations };
        }
        case "itemized": {
          if (items.length === 0) return { error: "Add at least one item" };
          const itemInputs = items.map((row, idx) => {
            const amount = itemizedItemCents[idx];
            const consumers = Object.entries(row.weights)
              .filter(([, w]) => w > 0)
              .map(([userId, weight]) => ({ userId, weight }));
            return {
              label: row.label.trim() || `Item ${idx + 1}`,
              amountCents: amount ?? NaN,
              consumers,
            };
          });
          if (itemInputs.some((i) => !Number.isSafeInteger(i.amountCents) || i.amountCents <= 0))
            return { error: "Every item needs a valid price" };
          if (itemInputs.some((i) => i.consumers.length === 0))
            return { error: "Every item needs at least one person on it" };
          const overheadInputs = overheads.map((o, idx) => ({
            kind: o.kind,
            label: o.label.trim() || o.kind,
            amountCents: itemizedOverheadCents[idx] ?? NaN,
            distribution: o.distribution,
          }));
          if (overheadInputs.some((o) => !Number.isSafeInteger(o.amountCents) || o.amountCents === 0))
            return { error: "Every overhead needs a valid amount" };
          return { method, items: itemInputs, overheads: overheadInputs };
        }
        case "adjustment": {
          if (!owerId) return { error: "Pick who owes" };
          return { method, owerId };
        }
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Invalid split" };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    method,
    members,
    evenParticipants,
    exactAmounts,
    shareCounts,
    percents,
    owerId,
    items,
    overheads,
    currency,
    totalStr,
  ]);

  const preview: Map<string, number> | { error: string } = useMemo(() => {
    if ("error" in split) return split;
    if (totalCents === null || totalCents <= 0)
      return { error: method === "itemized" ? "Add items to build the total" : "Enter a total amount" };
    try {
      return computeShares(totalCents, split);
    } catch (e) {
      return { error: e instanceof SplitError ? e.message : "Invalid split" };
    }
  }, [split, totalCents, method]);

  // IOU means someone is owed by definition, so KKB mode doesn't apply there.
  const kkbMode = !someonePaid && method !== "adjustment";

  // Payer validation: single payer auto-covers the total.
  const payerAmounts: { userId: string; amountCents: number }[] | { error: string } =
    useMemo(() => {
      if (totalCents === null || totalCents <= 0) return { error: "No total yet" };
      if (kkbMode) {
        // KKB: whoever holds the cash pile pays the restaurant. Bayad entered
        // becomes recorded payments to them; an empty bayad means unpaid — a
        // real debt to the cash holder until ticked off on the expense page.
        return [{ userId: payers[0].userId, amountCents: totalCents }];
      }
      if (payers.length === 1) {
        return [{ userId: payers[0].userId, amountCents: totalCents }];
      }
      const parsed = payers.map((p) => ({
        userId: p.userId,
        amountCents: parseAmountToCents(p.amountStr, currency) ?? NaN,
      }));
      if (parsed.some((p) => !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0))
        return { error: "Each payer needs a valid amount" };
      if (new Set(parsed.map((p) => p.userId)).size !== parsed.length)
        return { error: "Duplicate payer" };
      const sum = parsed.reduce((s, p) => s + p.amountCents, 0);
      if (sum !== totalCents)
        return {
          error: `Payers cover ${formatCents(sum, currency)} of ${formatCents(totalCents, currency)}`,
        };
      return parsed;
    }, [payers, totalCents, currency, kkbMode]);

  const formError =
    ("error" in preview ? preview.error : null) ??
    (Array.isArray(payerAmounts) ? null : payerAmounts.error) ??
    (description.trim() === "" ? "Add a description" : null);

  const canSubmit = !pending && formError === null;

  const submit = () => {
    if ("error" in split || totalCents === null || !Array.isArray(payerAmounts)) return;
    // Bayad typed into the sukli calculator becomes real recorded payments
    // to the payer (or cash holder in KKB mode) — create only, edits would
    // double-record what's already on the ledger.
    const payerIds = new Set(payerAmounts.map((p) => p.userId));
    const payments =
      !initial
        ? Object.entries(bayad)
            .map(([userId, str]) => ({
              userId,
              amountCents:
                str.trim() === "" ? 0 : (parseAmountToCents(str, currency) ?? 0),
            }))
            .filter((p) => p.amountCents > 0 && !payerIds.has(p.userId))
        : [];
    const payload: ExpensePayload = {
      description: description.trim(),
      totalCents,
      paidAt,
      notes: notes.trim() || undefined,
      payers: payerAmounts,
      payments: payments.length > 0 ? payments : undefined,
      split,
    };
    startTransition(async () => {
      const result = await submitAction(payload);
      if (result.error) {
        setServerError(result.error);
      } else {
        router.push(`/groups/${groupId}`);
        router.refresh();
      }
    });
  };

  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "?";

  /**
   * A payer who also ate must appear in the split. Idempotent: if they're
   * already anywhere in the split this is a no-op, and un-tapping them
   * afterwards still works. Exact/percent are left alone — we can't guess
   * amounts for them.
   */
  const includeInSplit = (userId: string) => {
    if (!userId) return;
    setEvenParticipants((prev) =>
      prev.has(userId) ? prev : new Set(prev).add(userId),
    );
    setItems((prev) =>
      prev.some((r) => (r.weights[userId] ?? 0) > 0)
        ? prev
        : prev.map((r) => ({ ...r, weights: { ...r.weights, [userId]: 1 } })),
    );
    setShareCounts((prev) => {
      const n = parseInt(prev[userId] || "0", 10);
      return Number.isInteger(n) && n > 0 ? prev : { ...prev, [userId]: "1" };
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:items-start lg:gap-x-10 lg:gap-y-6">
      <div className="space-y-6">
        {/* Basics */}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Description</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={140}
              placeholder="Dinner at Manam"
              className="field"
            />
          </label>
          {method !== "itemized" ? (
            <label className="text-sm">
              <span className="mb-1 block font-medium">
                Total <span className="microlabel">{currency}</span>
              </span>
              <input
                value={totalStr}
                onChange={(e) => setTotalStr(e.target.value)}
                inputMode="decimal"
                placeholder="1200.00"
                className="field font-mono tabular-nums"
              />
            </label>
          ) : (
            <div className="text-sm">
              <span className="mb-1 block font-medium">
                Total <span className="microlabel">{currency}</span>
              </span>
              <div className="rounded-lg border border-dashed border-line px-3 py-2 font-mono text-base tabular-nums text-ink-soft">
                {itemizedTotal !== null ? formatCents(itemizedTotal, currency) : "—"}
                <span className="ml-2 font-sans text-xs text-ink-faint">
                  from receipt
                </span>
              </div>
            </div>
          )}
          <label className="text-sm">
            <span className="mb-1 block font-medium">
              Date paid{" "}
              <span className="font-normal text-ink-faint">
                (backdate freely)
              </span>
            </span>
            <input
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
              className="field font-mono"
            />
          </label>
        </div>

        {/* Payers */}
        <section>
          <h3 className="microlabel mb-2">Who paid?</h3>
          {method !== "adjustment" && (
            <button
              type="button"
              role="switch"
              aria-checked={someonePaid}
              onClick={() => {
                const next = !someonePaid;
                setSomeonePaid(next);
                if (next) for (const p of payers) includeInSplit(p.userId);
              }}
              className="mb-3 inline-flex min-h-9 items-center gap-2.5"
            >
              <span
                className={`relative h-6 w-10 shrink-0 rounded-full border transition-colors duration-150 ${
                  someonePaid ? "border-accent bg-accent" : "border-line bg-cream"
                }`}
              >
                <span
                  className={`absolute left-1 top-1 size-4 rounded-full transition-transform duration-150 ${
                    someonePaid ? "translate-x-4 bg-cream" : "bg-ink-faint"
                  }`}
                />
              </span>
              <span className="text-sm font-medium">Someone fronted the bill</span>
            </button>
          )}
          {kkbMode ? (
            <div className="space-y-2">
              <p className="text-sm leading-relaxed text-ink-soft">
                Everyone pays their own share (KKB). The cash goes into one
                pile — whoever holds it covers anyone who hasn&rsquo;t paid
                yet. Leave someone&rsquo;s <strong>Bayad</strong> empty and
                they stay <em>unpaid</em>, owing the cash holder until ticked
                off on the expense page.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <span className="font-medium">Holding the cash:</span>
                <Select
                  value={payers[0]?.userId ?? ""}
                  onChange={(e) => {
                    setPayers([{ userId: e.target.value, amountStr: "" }]);
                    includeInSplit(e.target.value);
                  }}
                  wrapperClassName="inline-block w-auto min-w-32"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          ) : (
          <div className="space-y-2">
            {payers.map((p, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  value={p.userId}
                  onChange={(e) => {
                    setPayers(payers.map((row, i) => (i === idx ? { ...row, userId: e.target.value } : row)));
                    includeInSplit(e.target.value);
                  }}
                  wrapperClassName="inline-block w-auto min-w-32"
                >
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
                {payers.length > 1 && (
                  <input
                    value={p.amountStr}
                    onChange={(e) =>
                      setPayers(payers.map((row, i) => (i === idx ? { ...row, amountStr: e.target.value } : row)))
                    }
                    inputMode="decimal"
                    placeholder="amount"
                    aria-label={`Amount paid by ${nameOf(p.userId)}`}
                    className="field w-28 font-mono tabular-nums"
                  />
                )}
                {payers.length > 1 && (
                  <RemoveButton
                    onClick={() => setPayers(payers.filter((_, i) => i !== idx))}
                    label={`Remove payer ${nameOf(p.userId)}`}
                  />
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => {
                setPayers([...payers, { userId: members[0]?.id ?? "", amountStr: "" }]);
                includeInSplit(members[0]?.id ?? "");
              }}
              className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-accent-deep transition-colors hover:text-accent"
            >
              <IconPlus className="size-3.5" />
              Split the payment across another card/person
            </button>
            <p className="text-xs text-ink-faint">
              The payer doesn&rsquo;t have to be part of the split —
              &ldquo;I paid but didn&rsquo;t eat&rdquo; works.
            </p>
          </div>
          )}
        </section>

        {/* Method picker */}
        <section>
          <h3 className="microlabel mb-2">Split method</h3>
          <div
            role="tablist"
            aria-label="Split method"
            className="flex gap-1 overflow-x-auto rounded-xl border border-line bg-cream p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {METHODS.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={method === m.id}
                onClick={() => setMethod(m.id)}
                className={`shrink-0 rounded-lg px-3 py-2 font-mono text-xs font-medium uppercase tracking-wider transition duration-150 active:translate-y-px ${
                  method === m.id
                    ? "bg-ink text-cream"
                    : "text-ink-faint hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Method sub-forms */}
          <div className="mt-3">
            {method === "even" && (
              <div className="space-y-2">
                <p className="text-sm text-ink-soft">Split evenly between:</p>
                <div className="flex flex-wrap gap-2">
                  {members.map((m) => {
                    const on = evenParticipants.has(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          const next = new Set(evenParticipants);
                          if (on) next.delete(m.id);
                          else next.add(m.id);
                          setEvenParticipants(next);
                        }}
                        className={`chip ${on ? "chip-on" : "chip-off"}`}
                      >
                        {m.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {method === "exact" && (
              <div className="space-y-2">
                <p className="text-sm text-ink-soft">
                  Exact amounts (leave blank to exclude). Must add up to the
                  total.
                </p>
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-3 text-sm">
                    <span className="w-32 truncate">{m.name}</span>
                    <input
                      value={exactAmounts[m.id] ?? ""}
                      onChange={(e) => setExactAmounts({ ...exactAmounts, [m.id]: e.target.value })}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="field w-28 font-mono tabular-nums"
                    />
                  </label>
                ))}
              </div>
            )}

            {method === "shares" && (
              <div className="space-y-2">
                <p className="text-sm text-ink-soft">
                  Weights — e.g. 2 for the couple, 1 for each single. 0
                  excludes.
                </p>
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-3 text-sm">
                    <span className="w-32 truncate">{m.name}</span>
                    <input
                      value={shareCounts[m.id] ?? ""}
                      onChange={(e) => setShareCounts({ ...shareCounts, [m.id]: e.target.value })}
                      inputMode="numeric"
                      className="field w-20 font-mono tabular-nums"
                    />
                  </label>
                ))}
              </div>
            )}

            {method === "percent" && (
              <div className="space-y-2">
                <p className="text-sm text-ink-soft">
                  Percentages (up to 2 decimals). Must total exactly 100%.
                </p>
                {members.map((m) => (
                  <label key={m.id} className="flex items-center gap-3 text-sm">
                    <span className="w-32 truncate">{m.name}</span>
                    <input
                      value={percents[m.id] ?? ""}
                      onChange={(e) => setPercents({ ...percents, [m.id]: e.target.value })}
                      inputMode="decimal"
                      placeholder="33.33"
                      className="field w-24 font-mono tabular-nums"
                    />
                    <span className="text-ink-faint">%</span>
                  </label>
                ))}
              </div>
            )}

            {method === "adjustment" && (
              <div className="space-y-2 text-sm">
                <p className="text-ink-soft">
                  Quick IOU — the whole amount is owed by one person to the
                  payer. (&ldquo;You spotted me ₱200 at the arcade.&rdquo;)
                </p>
                <label className="flex items-center gap-2">
                  <span>Who owes:</span>
                  <Select
                    value={owerId}
                    onChange={(e) => setOwerId(e.target.value)}
                    wrapperClassName="inline-block w-auto min-w-32"
                  >
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
            )}

            {method === "itemized" && (
              <div className="space-y-4">
                <p className="text-sm leading-relaxed text-ink-soft">
                  Enter the receipt line by line. Bump the qty when the same
                  order was had by more than one person, then tap names to
                  toggle who had each item.
                </p>
                {scanAction && (
                  <ReceiptScanButton scanAction={scanAction} onResult={applyScan} />
                )}
                <div className="space-y-3">
                  {items.map((item, idx) => {
                    const unitCents = parseAmountToCents(item.amountStr, currency);
                    const lineTotalCents = itemizedItemCents[idx];
                    return (
                    <div
                      key={idx}
                      className="rounded-xl border border-line bg-cream p-3"
                    >
                      <div className="flex items-center gap-2">
                        <input
                          value={item.label}
                          onChange={(e) =>
                            setItems(items.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))
                          }
                          placeholder={`Item ${idx + 1} — e.g. Caesar salad`}
                          className="field min-w-0 flex-1"
                        />
                        <input
                          value={item.amountStr}
                          onChange={(e) =>
                            setItems(items.map((r, i) => (i === idx ? { ...r, amountStr: e.target.value } : r)))
                          }
                          inputMode="decimal"
                          placeholder={item.qty > 1 ? "each" : "price"}
                          aria-label={`Price of item ${idx + 1}${item.qty > 1 ? " (each)" : ""}`}
                          className="field w-[4.5rem] font-mono tabular-nums"
                        />
                        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-line bg-cream">
                          <button
                            type="button"
                            onClick={() =>
                              setItems(
                                items.map((r, i) =>
                                  i === idx ? { ...r, qty: Math.max(1, r.qty - 1) } : r,
                                ),
                              )
                            }
                            disabled={item.qty <= 1}
                            aria-label={`Decrease quantity of item ${idx + 1}`}
                            className="flex size-7 items-center justify-center text-ink-faint transition-colors hover:bg-line-soft active:translate-y-px disabled:opacity-30"
                          >
                            <IconMinus className="size-3.5" />
                          </button>
                          <span
                            aria-label={`Quantity of item ${idx + 1}`}
                            className="w-4 text-center font-mono text-xs tabular-nums"
                          >
                            {item.qty}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setItems(
                                items.map((r, i) => (i === idx ? { ...r, qty: r.qty + 1 } : r)),
                              )
                            }
                            aria-label={`Increase quantity of item ${idx + 1}`}
                            className="flex size-7 items-center justify-center text-ink-faint transition-colors hover:bg-line-soft active:translate-y-px"
                          >
                            <IconPlus className="size-3.5" />
                          </button>
                        </div>
                        <RemoveButton
                          onClick={() => setItems(items.filter((_, i) => i !== idx))}
                          label={`Remove item ${idx + 1}`}
                        />
                      </div>
                      {item.qty > 1 && unitCents !== null && lineTotalCents !== null && (
                        <p className="mt-1.5 text-xs text-ink-faint">
                          <span className="font-mono tabular-nums text-ink-soft">
                            {formatCents(lineTotalCents, currency)}
                          </span>{" "}
                          total ({item.qty} × {formatCents(unitCents, currency)} each)
                        </p>
                      )}
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {members.map((m) => {
                          const w = item.weights[m.id] ?? 0;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              aria-pressed={w > 0}
                              onClick={() =>
                                setItems(
                                  items.map((r, i) =>
                                    i === idx
                                      ? { ...r, weights: { ...r.weights, [m.id]: w > 0 ? 0 : 1 } }
                                      : r,
                                  ),
                                )
                              }
                              className={`chip min-h-7 px-2.5 py-0.5 text-xs ${
                                w > 0 ? "chip-on" : "chip-off"
                              }`}
                            >
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setItems([...items, { label: "", amountStr: "", qty: 1, weights: allWeightsOn() }])}
                  className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-accent-deep transition-colors hover:text-accent"
                >
                  <IconPlus className="size-3.5" />
                  Add item
                </button>

                <div className="space-y-2 border-t border-dashed border-line pt-4">
                  <p className="microlabel">Tax · tip · service · discount</p>
                  {overheads.map((o, idx) => (
                    <div key={idx} className="flex flex-wrap items-center gap-2">
                      <Select
                        value={o.kind}
                        onChange={(e) =>
                          setOverheads(
                            overheads.map((r, i) =>
                              i === idx ? { ...r, kind: e.target.value as OverheadRow["kind"] } : r,
                            ),
                          )
                        }
                        wrapperClassName="inline-block w-auto"
                      >
                        <option value="tax">Tax</option>
                        <option value="tip">Tip</option>
                        <option value="service">Service charge</option>
                        <option value="discount">Discount</option>
                      </Select>
                      <input
                        value={o.amountStr}
                        onChange={(e) =>
                          setOverheads(overheads.map((r, i) => (i === idx ? { ...r, amountStr: e.target.value } : r)))
                        }
                        inputMode="decimal"
                        placeholder="amount"
                        aria-label={`${o.kind} amount`}
                        className="field w-24 font-mono tabular-nums"
                      />
                      <Select
                        value={o.distribution}
                        onChange={(e) =>
                          setOverheads(
                            overheads.map((r, i) =>
                              i === idx
                                ? { ...r, distribution: e.target.value as OverheadRow["distribution"] }
                                : r,
                            ),
                          )
                        }
                        wrapperClassName="inline-block w-auto"
                      >
                        <option value="proportional">proportional to what you ate</option>
                        <option value="even">split evenly</option>
                      </Select>
                      <RemoveButton
                        onClick={() => setOverheads(overheads.filter((_, i) => i !== idx))}
                        label={`Remove ${o.kind}`}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setOverheads([
                        ...overheads,
                        { kind: "tip", label: "", amountStr: "", distribution: "proportional" },
                      ])
                    }
                    className="inline-flex min-h-9 items-center gap-1.5 text-sm font-medium text-accent-deep transition-colors hover:text-accent"
                  >
                    <IconPlus className="size-3.5" />
                    Add tax/tip/discount
                  </button>
                </div>
                {scannedTotalCents !== null &&
                  itemizedTotal !== null &&
                  itemizedTotal !== scannedTotalCents && (
                    <p className="text-xs leading-relaxed text-warn">
                      The receipt prints{" "}
                      <span className="font-mono tabular-nums">
                        {formatCents(scannedTotalCents, currency)}
                      </span>{" "}
                      but these lines add up to{" "}
                      <span className="font-mono tabular-nums">
                        {formatCents(itemizedTotal, currency)}
                      </span>{" "}
                      — double-check the scanned lines.
                    </p>
                  )}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Live preview — same computeShares the server runs */}
      <div className="mt-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-0">
        <div className="card tear-b p-4">
          <h3 className="microlabel mb-3 border-b border-dashed border-line pb-2">
            {method === "itemized" ? "Preview · sukli calculator" : "Preview"}
          </h3>
          {"error" in preview ? (
            <p className="text-sm text-warn">{preview.error}</p>
          ) : method === "itemized" ? (
            <div className="space-y-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem_4.5rem] items-center gap-1.5 pb-1 microlabel">
                <span />
                <span className="text-right">Share</span>
                <span className="text-right">Bayad</span>
                <span className="text-right">Sukli</span>
              </div>
              {[...preview.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([uid, cents]) => {
                  const raw = (bayad[uid] ?? "").trim();
                  const paid = raw === "" ? null : parseAmountToCents(raw, currency);
                  const sukli = paid === null ? null : paid - cents;
                  return (
                    <div
                      key={uid}
                      className="grid grid-cols-[minmax(0,1fr)_4rem_4.5rem_4.5rem] items-center gap-1.5 text-sm"
                    >
                      <span className="truncate">{nameOf(uid)}</span>
                      <span className="text-right font-mono font-medium tabular-nums">
                        {formatCents(cents, currency)}
                      </span>
                      <input
                        value={bayad[uid] ?? ""}
                        onChange={(e) => setBayad({ ...bayad, [uid]: e.target.value })}
                        inputMode="decimal"
                        placeholder="cash"
                        aria-label={`Cash handed over by ${nameOf(uid)}`}
                        className="field px-2 py-1 text-right font-mono text-sm tabular-nums"
                      />
                      <span className="text-right font-mono text-xs tabular-nums">
                        {raw === "" ? (
                          <span className="text-line">—</span>
                        ) : sukli === null ? (
                          <span className="text-neg">?</span>
                        ) : sukli >= 0 ? (
                          <span className="font-medium text-pos">
                            {formatCents(sukli, currency)}
                          </span>
                        ) : (
                          <span className="font-medium text-neg">
                            kulang {formatCents(-sukli, currency)}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              {(() => {
                const rows = [...preview.entries()].map(([uid, cents]) => {
                  const raw = (bayad[uid] ?? "").trim();
                  const paid = raw === "" ? null : parseAmountToCents(raw, currency);
                  return { cents, paid };
                });
                const entered = rows.filter((r) => r.paid !== null);
                if (entered.length === 0) {
                  return (
                    <p className="border-t border-dashed border-line pt-2 text-xs leading-relaxed text-ink-faint">
                      Type each person&rsquo;s cash under{" "}
                      <strong>Bayad</strong> to get their sukli.{" "}
                      {initial
                        ? "This is just a table-side calculator — it doesn't change what gets recorded."
                        : kkbMode
                          ? "Cash entered here is recorded as paid to whoever holds the pile — left empty, that person shows as unpaid and owes their share."
                          : "Cash entered here is recorded as payment to whoever fronted the bill — overpay and the sukli shows up as owed back."}
                    </p>
                  );
                }
                const collected = entered.reduce((s, r) => s + (r.paid ?? 0), 0);
                const changeBack = entered.reduce(
                  (s, r) => s + Math.max(0, (r.paid ?? 0) - r.cents),
                  0,
                );
                const short = entered.reduce(
                  (s, r) => s + Math.max(0, r.cents - (r.paid ?? 0)),
                  0,
                );
                return (
                  <div className="space-y-1 border-t border-dashed border-line pt-2 text-xs text-ink-soft">
                    <p className="flex items-baseline justify-between gap-2">
                      <span>Collected</span>
                      <strong className="font-mono tabular-nums">
                        {formatCents(collected, currency)}
                      </strong>
                    </p>
                    <p className="flex items-baseline justify-between gap-2">
                      <span>Sukli to hand back</span>
                      <strong className="font-mono tabular-nums text-pos">
                        {formatCents(changeBack, currency)}
                      </strong>
                    </p>
                    {short > 0 && (
                      <p className="flex items-baseline justify-between gap-2">
                        <span>Still kulang</span>
                        <strong className="font-mono tabular-nums text-neg">
                          {formatCents(short, currency)}
                        </strong>
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <ul className="space-y-1 text-sm">
              {[...preview.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([uid, cents]) => (
                  <li key={uid} className="flex items-baseline justify-between gap-2">
                    <span className="truncate">{nameOf(uid)}</span>
                    <span className="font-mono font-medium tabular-nums">
                      {formatCents(cents, currency)}
                    </span>
                  </li>
                ))}
              <li className="mt-1 flex items-baseline justify-between gap-2 border-t border-dashed border-line pt-2 text-ink-faint">
                <span className="inline-flex items-center gap-1">
                  Unallocated
                  <IconCheck className="size-3.5 text-pos" />
                </span>
                <span className="font-mono tabular-nums">
                  {formatCents(0, currency)}
                </span>
              </li>
            </ul>
          )}
        </div>
      </div>

      <div className="mt-6 space-y-4 lg:col-start-1 lg:row-start-2 lg:mt-0">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Notes (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            rows={2}
            className="field"
          />
        </label>

        {(formError || serverError) && (
          <p role="alert" className="text-sm text-neg">
            {serverError ?? formError}
          </p>
        )}

        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="btn btn-primary min-h-12 w-full px-4 text-base"
        >
          {pending ? "Saving…" : initial ? "Save changes" : "Add expense"}
        </button>
      </div>
    </div>
  );
}
