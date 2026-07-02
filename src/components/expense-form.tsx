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

export interface MemberOption {
  id: string;
  name: string;
  isGhost: boolean;
}

interface PayerRow {
  userId: string;
  amountStr: string;
}

interface ItemRow {
  label: string;
  amountStr: string;
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

const inputClass =
  "rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm focus:border-emerald-500 focus:outline-none";

/** Percent string ("33.33") -> integer basis points (3333), or null. */
function parsePercentToBp(raw: string): number | null {
  const cleaned = raw.trim();
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return parseInt(whole, 10) * 100 + (frac ? parseInt(frac.padEnd(2, "0"), 10) : 0);
}

export function ExpenseForm({
  groupId,
  currency,
  members,
  currentUserId,
  initial,
  submitAction,
}: {
  groupId: string;
  currency: string;
  members: MemberOption[];
  currentUserId: string;
  initial?: {
    description: string;
    totalCents: number;
    paidAt: string;
    notes?: string;
    payers: { userId: string; amountCents: number }[];
    split: SplitInput | null;
  };
  submitAction: (payload: ExpensePayload) => Promise<{ ok?: boolean; error?: string }>;
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
    })) ?? [{ userId: currentUserId, amountStr: "" }],
  );

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
      : (members.find((m) => m.id !== currentUserId)?.id ?? members[0]?.id ?? ""),
  );

  // "Bayad" — cash each person hands over at the table. Purely a table-side
  // calculator: sukli (change) = bayad − share. Never persisted, never
  // touches the ledger.
  const [bayad, setBayad] = useState<Record<string, string>>({});

  const allWeightsOn = () =>
    Object.fromEntries(members.map((m) => [m.id, 1]));
  const [items, setItems] = useState<ItemRow[]>(() =>
    initialSplit?.method === "itemized"
      ? initialSplit.items.map((i) => ({
          label: i.label,
          amountStr: toAmountStr(i.amountCents),
          weights: {
            ...Object.fromEntries(members.map((m) => [m.id, 0])),
            ...Object.fromEntries(i.consumers.map((c) => [c.userId, c.weight])),
          },
        }))
      : [{ label: "", amountStr: "", weights: allWeightsOn() }],
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

  // ── Derived: totals, split input, live preview ────────────────────────
  const itemizedItemCents = items.map((i) => parseAmountToCents(i.amountStr, currency));
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

  // Payer validation: single payer auto-covers the total.
  const payerAmounts: { userId: string; amountCents: number }[] | { error: string } =
    useMemo(() => {
      if (totalCents === null || totalCents <= 0) return { error: "No total yet" };
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
    }, [payers, totalCents, currency]);

  const formError =
    ("error" in preview ? preview.error : null) ??
    (Array.isArray(payerAmounts) ? null : payerAmounts.error) ??
    (description.trim() === "" ? "Add a description" : null);

  const canSubmit = !pending && formError === null;

  const submit = () => {
    if ("error" in split || totalCents === null || !Array.isArray(payerAmounts)) return;
    const payload: ExpensePayload = {
      description: description.trim(),
      totalCents,
      paidAt,
      notes: notes.trim() || undefined,
      payers: payerAmounts,
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

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Basics */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Description</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={140}
            placeholder="Dinner at Manam"
            className={`${inputClass} w-full`}
          />
        </label>
        {method !== "itemized" ? (
          <label className="text-sm">
            <span className="mb-1 block font-medium">Total ({currency})</span>
            <input
              value={totalStr}
              onChange={(e) => setTotalStr(e.target.value)}
              inputMode="decimal"
              placeholder="1200.00"
              className={`${inputClass} w-full`}
            />
          </label>
        ) : (
          <div className="text-sm">
            <span className="mb-1 block font-medium">Total ({currency})</span>
            <div className="rounded-md border border-dashed border-zinc-300 px-2.5 py-1.5 text-zinc-600">
              {itemizedTotal !== null ? formatCents(itemizedTotal, currency) : "—"}
              <span className="ml-1 text-xs text-zinc-400">(from receipt)</span>
            </div>
          </div>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-medium">
            Date paid <span className="font-normal text-zinc-400">(backdate freely)</span>
          </span>
          <input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            className={`${inputClass} w-full`}
          />
        </label>
      </div>

      {/* Payers */}
      <fieldset className="rounded-lg border border-zinc-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium">Who paid?</legend>
        <div className="space-y-2">
          {payers.map((p, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <select
                value={p.userId}
                onChange={(e) =>
                  setPayers(payers.map((row, i) => (i === idx ? { ...row, userId: e.target.value } : row)))
                }
                className={inputClass}
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.isGhost ? " (ghost)" : ""}
                  </option>
                ))}
              </select>
              {payers.length > 1 && (
                <input
                  value={p.amountStr}
                  onChange={(e) =>
                    setPayers(payers.map((row, i) => (i === idx ? { ...row, amountStr: e.target.value } : row)))
                  }
                  inputMode="decimal"
                  placeholder="amount"
                  className={`${inputClass} w-28`}
                />
              )}
              {payers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setPayers(payers.filter((_, i) => i !== idx))}
                  className="text-sm text-zinc-400 hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => setPayers([...payers, { userId: members[0]?.id ?? "", amountStr: "" }])}
            className="text-sm text-emerald-600 hover:underline"
          >
            + Split the payment across another card/person
          </button>
          <p className="text-xs text-zinc-400">
            The payer doesn&rsquo;t have to be part of the split — &ldquo;I paid but didn&rsquo;t eat&rdquo; works.
          </p>
        </div>
      </fieldset>

      {/* Method picker */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-zinc-100 p-1">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMethod(m.id)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              method === m.id ? "bg-white shadow-sm" : "text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Method sub-forms */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        {method === "even" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">Split evenly between:</p>
            <div className="flex flex-wrap gap-2">
              {members.map((m) => {
                const on = evenParticipants.has(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      const next = new Set(evenParticipants);
                      if (on) next.delete(m.id);
                      else next.add(m.id);
                      setEvenParticipants(next);
                    }}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      on
                        ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                        : "border-zinc-300 text-zinc-400"
                    }`}
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
            <p className="text-sm text-zinc-500">
              Exact amounts (leave blank to exclude). Must add up to the total.
            </p>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate">{m.name}</span>
                <input
                  value={exactAmounts[m.id] ?? ""}
                  onChange={(e) => setExactAmounts({ ...exactAmounts, [m.id]: e.target.value })}
                  inputMode="decimal"
                  placeholder="0.00"
                  className={`${inputClass} w-28`}
                />
              </label>
            ))}
          </div>
        )}

        {method === "shares" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">
              Weights — e.g. 2 for the couple, 1 for each single. 0 excludes.
            </p>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate">{m.name}</span>
                <input
                  value={shareCounts[m.id] ?? ""}
                  onChange={(e) => setShareCounts({ ...shareCounts, [m.id]: e.target.value })}
                  inputMode="numeric"
                  className={`${inputClass} w-20`}
                />
              </label>
            ))}
          </div>
        )}

        {method === "percent" && (
          <div className="space-y-2">
            <p className="text-sm text-zinc-500">
              Percentages (up to 2 decimals). Must total exactly 100%.
            </p>
            {members.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate">{m.name}</span>
                <input
                  value={percents[m.id] ?? ""}
                  onChange={(e) => setPercents({ ...percents, [m.id]: e.target.value })}
                  inputMode="decimal"
                  placeholder="33.33"
                  className={`${inputClass} w-24`}
                />
                <span className="text-zinc-400">%</span>
              </label>
            ))}
          </div>
        )}

        {method === "adjustment" && (
          <div className="space-y-2 text-sm">
            <p className="text-zinc-500">
              Quick IOU — the whole amount is owed by one person to the payer.
              (&ldquo;You spotted me ₱200 at the arcade.&rdquo;)
            </p>
            <label className="flex items-center gap-2">
              <span>Who owes:</span>
              <select value={owerId} onChange={(e) => setOwerId(e.target.value)} className={inputClass}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {method === "itemized" && (
          <div className="space-y-4">
            <p className="text-sm text-zinc-500">
              Enter the receipt line by line. Tap names to toggle who had each
              item; tap again for double weight (&times;2, &times;3) when
              someone ate more of a shared dish.
            </p>
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={idx} className="rounded-md border border-zinc-200 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.label}
                      onChange={(e) =>
                        setItems(items.map((r, i) => (i === idx ? { ...r, label: e.target.value } : r)))
                      }
                      placeholder={`Item ${idx + 1} — e.g. Caesar salad`}
                      className={`${inputClass} flex-1`}
                    />
                    <input
                      value={item.amountStr}
                      onChange={(e) =>
                        setItems(items.map((r, i) => (i === idx ? { ...r, amountStr: e.target.value } : r)))
                      }
                      inputMode="decimal"
                      placeholder="price"
                      className={`${inputClass} w-24`}
                    />
                    <button
                      type="button"
                      onClick={() => setItems(items.filter((_, i) => i !== idx))}
                      className="text-sm text-zinc-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {members.map((m) => {
                      const w = item.weights[m.id] ?? 0;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setItems(
                              items.map((r, i) =>
                                i === idx
                                  ? { ...r, weights: { ...r.weights, [m.id]: (w + 1) % 4 } }
                                  : r,
                              ),
                            )
                          }
                          className={`rounded-full border px-2.5 py-0.5 text-xs ${
                            w > 0
                              ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                              : "border-zinc-300 text-zinc-400"
                          }`}
                        >
                          {m.name}
                          {w > 1 ? ` ×${w}` : ""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setItems([...items, { label: "", amountStr: "", weights: allWeightsOn() }])}
              className="text-sm text-emerald-600 hover:underline"
            >
              + Add item
            </button>

            <div className="space-y-2 border-t border-zinc-100 pt-3">
              <p className="text-sm font-medium">Tax / tip / service / discount</p>
              {overheads.map((o, idx) => (
                <div key={idx} className="flex flex-wrap items-center gap-2">
                  <select
                    value={o.kind}
                    onChange={(e) =>
                      setOverheads(
                        overheads.map((r, i) =>
                          i === idx ? { ...r, kind: e.target.value as OverheadRow["kind"] } : r,
                        ),
                      )
                    }
                    className={inputClass}
                  >
                    <option value="tax">Tax</option>
                    <option value="tip">Tip</option>
                    <option value="service">Service charge</option>
                    <option value="discount">Discount</option>
                  </select>
                  <input
                    value={o.amountStr}
                    onChange={(e) =>
                      setOverheads(overheads.map((r, i) => (i === idx ? { ...r, amountStr: e.target.value } : r)))
                    }
                    inputMode="decimal"
                    placeholder="amount"
                    className={`${inputClass} w-24`}
                  />
                  <select
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
                    className={inputClass}
                  >
                    <option value="proportional">proportional to what you ate</option>
                    <option value="even">split evenly</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setOverheads(overheads.filter((_, i) => i !== idx))}
                    className="text-sm text-zinc-400 hover:text-red-600"
                  >
                    ✕
                  </button>
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
                className="text-sm text-emerald-600 hover:underline"
              >
                + Add tax/tip/discount
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Live preview — same computeShares the server runs */}
      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          {method === "itemized" ? "Preview & sukli calculator" : "Preview"}
        </h3>
        {"error" in preview ? (
          <p className="text-sm text-amber-600">{preview.error}</p>
        ) : method === "itemized" ? (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_5rem_6rem_6rem] items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
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
                    className="grid grid-cols-[1fr_5rem_6rem_6rem] items-center gap-2 text-sm"
                  >
                    <span className="truncate">{nameOf(uid)}</span>
                    <span className="text-right font-medium">
                      {formatCents(cents, currency)}
                    </span>
                    <input
                      value={bayad[uid] ?? ""}
                      onChange={(e) => setBayad({ ...bayad, [uid]: e.target.value })}
                      inputMode="decimal"
                      placeholder="cash"
                      className={`${inputClass} w-full text-right`}
                    />
                    <span className="text-right">
                      {raw === "" ? (
                        <span className="text-zinc-300">—</span>
                      ) : sukli === null ? (
                        <span className="text-red-600">?</span>
                      ) : sukli >= 0 ? (
                        <span className="font-medium text-emerald-600">
                          {formatCents(sukli, currency)}
                        </span>
                      ) : (
                        <span className="font-medium text-red-600">
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
                  <p className="border-t border-zinc-100 pt-2 text-xs text-zinc-400">
                    Type each person&rsquo;s cash under <strong>Bayad</strong>{" "}
                    to get their sukli. This is just a table-side calculator —
                    it doesn&rsquo;t change what gets recorded.
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
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-zinc-100 pt-2 text-xs text-zinc-500">
                  <span>
                    Collected: <strong>{formatCents(collected, currency)}</strong>
                  </span>
                  <span>
                    Sukli to hand back:{" "}
                    <strong className="text-emerald-600">
                      {formatCents(changeBack, currency)}
                    </strong>
                  </span>
                  {short > 0 && (
                    <span>
                      Still kulang:{" "}
                      <strong className="text-red-600">
                        {formatCents(short, currency)}
                      </strong>
                    </span>
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
                <li key={uid} className="flex justify-between">
                  <span>{nameOf(uid)}</span>
                  <span className="font-medium">{formatCents(cents, currency)}</span>
                </li>
              ))}
            <li className="flex justify-between border-t border-zinc-100 pt-1 text-zinc-500">
              <span>Unallocated</span>
              <span>{formatCents(0, currency)} ✓</span>
            </li>
          </ul>
        )}
      </div>

      <label className="block text-sm">
        <span className="mb-1 block font-medium">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={2}
          className={`${inputClass} w-full`}
        />
      </label>

      {(formError || serverError) && (
        <p className="text-sm text-red-600">{serverError ?? formError}</p>
      )}

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="w-full rounded-md bg-emerald-600 px-4 py-2.5 font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
      >
        {pending ? "Saving…" : initial ? "Save changes" : "Add expense"}
      </button>
    </div>
  );
}
