/**
 * The split engine: computeShares(totalCents, input) -> Map<userId, cents>.
 *
 * Pure module — no DB, no framework imports. The persisted ledger stores the
 * OUTPUT of this function (expense_shares rows), so the ledger stays frozen
 * math even if this algorithm changes later.
 */
import { z } from "zod";
import { allocateByWeights } from "./rounding";

const userId = z.string().min(1);
const cents = z.number().int().refine(Number.isSafeInteger, "unsafe integer");
const positiveCents = cents.refine((n) => n > 0, "must be positive");

export const itemInputSchema = z.object({
  label: z.string().min(1),
  amountCents: positiveCents,
  consumers: z
    .array(z.object({ userId, weight: z.number().int().min(1) }))
    .min(1, "every item needs at least one consumer"),
});

export const overheadInputSchema = z.object({
  kind: z.enum(["tax", "tip", "service", "discount"]),
  label: z.string().min(1),
  /** Positive for tax/tip/service; negative for discounts. */
  amountCents: cents.refine((n) => n !== 0, "overhead cannot be zero"),
  /** Proportional to each person's item subtotal, or split evenly. */
  distribution: z.enum(["proportional", "even"]),
});

export const splitInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("even"),
    participants: z.array(userId).min(1),
  }),
  z.object({
    method: z.literal("exact"),
    allocations: z
      .array(z.object({ userId, amountCents: positiveCents }))
      .min(1),
  }),
  z.object({
    method: z.literal("shares"),
    allocations: z
      .array(z.object({ userId, shares: z.number().int().min(1) }))
      .min(1),
  }),
  z.object({
    method: z.literal("percent"),
    // Basis points: 10000 = 100%. Integers only — never 33.33.
    allocations: z
      .array(z.object({ userId, basisPoints: z.number().int().min(1) }))
      .min(1),
  }),
  z.object({
    method: z.literal("itemized"),
    items: z.array(itemInputSchema).min(1),
    overheads: z.array(overheadInputSchema),
  }),
  z.object({
    // Standalone IOU: "you spotted me ₱200" — one ower, whole amount.
    method: z.literal("adjustment"),
    owerId: userId,
  }),
]);

export type SplitInput = z.infer<typeof splitInputSchema>;
export type ItemInput = z.infer<typeof itemInputSchema>;
export type OverheadInput = z.infer<typeof overheadInputSchema>;

function assertNoDuplicates(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new SplitError(`duplicate participant: ${id}`);
    seen.add(id);
  }
}

export class SplitError extends Error {}

/**
 * Compute each participant's share of `totalCents` for the given split input.
 * Output invariant: values sum exactly to totalCents (conservation).
 */
export function computeShares(
  totalCents: number,
  input: SplitInput,
): Map<string, number> {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new SplitError("total must be a positive integer amount in cents");
  }

  switch (input.method) {
    case "even": {
      assertNoDuplicates(input.participants);
      return allocateByWeights(
        totalCents,
        input.participants.map((id) => ({ key: id, weight: 1 })),
      );
    }

    case "exact": {
      assertNoDuplicates(input.allocations.map((a) => a.userId));
      const sum = input.allocations.reduce((s, a) => s + a.amountCents, 0);
      if (sum !== totalCents) {
        throw new SplitError(
          `exact allocations sum to ${sum}, expected ${totalCents}`,
        );
      }
      return new Map(input.allocations.map((a) => [a.userId, a.amountCents]));
    }

    case "shares": {
      assertNoDuplicates(input.allocations.map((a) => a.userId));
      return allocateByWeights(
        totalCents,
        input.allocations.map((a) => ({ key: a.userId, weight: a.shares })),
      );
    }

    case "percent": {
      assertNoDuplicates(input.allocations.map((a) => a.userId));
      const bp = input.allocations.reduce((s, a) => s + a.basisPoints, 0);
      if (bp !== 10000) {
        throw new SplitError(`percentages sum to ${bp} bp, expected 10000`);
      }
      return allocateByWeights(
        totalCents,
        input.allocations.map((a) => ({ key: a.userId, weight: a.basisPoints })),
      );
    }

    case "itemized":
      return computeItemizedShares(totalCents, input.items, input.overheads);

    case "adjustment":
      return new Map([[input.owerId, totalCents]]);
  }
}

/**
 * Itemized split ("I only had a salad"):
 * 1. Each item is allocated across its consumers by weight.
 * 2. Each overhead is distributed proportionally to per-person item subtotals
 *    (the salad person shouldn't pay tip on your steak) or evenly, per input.
 * 3. Items + overheads must reconcile with the expense total.
 */
function computeItemizedShares(
  totalCents: number,
  items: ItemInput[],
  overheads: OverheadInput[],
): Map<string, number> {
  const itemsSubtotal = items.reduce((s, i) => s + i.amountCents, 0);
  const overheadTotal = overheads.reduce((s, o) => s + o.amountCents, 0);
  if (itemsSubtotal + overheadTotal !== totalCents) {
    throw new SplitError(
      `items (${itemsSubtotal}) + overheads (${overheadTotal}) != total (${totalCents})`,
    );
  }
  for (const o of overheads) {
    if (o.kind === "discount" && o.amountCents > 0) {
      throw new SplitError(`discount "${o.label}" must be negative`);
    }
    if (o.kind !== "discount" && o.amountCents < 0) {
      throw new SplitError(`${o.kind} "${o.label}" must be positive`);
    }
  }

  // Step 1: per-person item subtotals. These stay frozen — overheads are
  // weighted by what each person *consumed*, never by running totals that
  // earlier overheads already shifted.
  const itemSubtotals = new Map<string, number>();
  for (const item of items) {
    assertNoDuplicates(item.consumers.map((c) => c.userId));
    const alloc = allocateByWeights(
      item.amountCents,
      item.consumers.map((c) => ({ key: c.userId, weight: c.weight })),
    );
    for (const [uid, amount] of alloc) {
      itemSubtotals.set(uid, (itemSubtotals.get(uid) ?? 0) + amount);
    }
  }

  const totals = new Map(itemSubtotals);

  // Step 2: distribute each overhead independently (so a proportional tip and
  // an even service charge can coexist on one receipt).
  const everyone = [...itemSubtotals.keys()].sort();
  for (const o of overheads) {
    const recipients =
      o.distribution === "even"
        ? everyone.map((uid) => ({ key: uid, weight: 1 }))
        : everyone.map((uid) => ({ key: uid, weight: itemSubtotals.get(uid)! }));
    const alloc = allocateByWeights(o.amountCents, recipients);
    for (const [uid, amount] of alloc) {
      totals.set(uid, (totals.get(uid) ?? 0) + amount);
    }
  }

  // Conservation check.
  let sum = 0;
  for (const v of totals.values()) sum += v;
  if (sum !== totalCents) {
    throw new SplitError(
      `itemized conservation violated: ${sum} != ${totalCents}`,
    );
  }
  return totals;
}
