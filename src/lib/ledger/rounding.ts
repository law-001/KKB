/**
 * Largest-remainder allocation of an integer amount across weighted recipients.
 *
 * Money-math rules (see build plan §4):
 * - All amounts are integer minor units (cents/centavos). No floats survive
 *   past intermediate remainder comparison, and even those are exact because
 *   we compare integer remainders (amount*weight mod totalWeight).
 * - Conservation: the returned amounts always sum EXACTLY to `totalCents`.
 * - Deterministic tie-break: equal remainders are resolved by ascending key
 *   sort, so the same input always yields the same output.
 */

export interface WeightedRecipient {
  /** Stable identifier (e.g. userId). Used for deterministic tie-breaking. */
  key: string;
  /** Non-negative integer weight. At least one must be positive. */
  weight: number;
}

/**
 * Split `totalCents` proportionally to `weights`, distributing remainder
 * pennies to the largest fractional remainders (largest-remainder method).
 *
 * Works for negative totals (discounts/refunds) by symmetry:
 * allocate(-t, w) === -allocate(t, w) entry-wise.
 */
export function allocateByWeights(
  totalCents: number,
  recipients: WeightedRecipient[],
): Map<string, number> {
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error(`totalCents must be a safe integer, got ${totalCents}`);
  }
  if (recipients.length === 0) {
    throw new Error("allocateByWeights requires at least one recipient");
  }
  const keys = new Set<string>();
  for (const r of recipients) {
    if (!Number.isSafeInteger(r.weight) || r.weight < 0) {
      throw new Error(`weight for ${r.key} must be a non-negative integer`);
    }
    if (keys.has(r.key)) throw new Error(`duplicate recipient key: ${r.key}`);
    keys.add(r.key);
  }
  const totalWeight = recipients.reduce((s, r) => s + r.weight, 0);
  if (totalWeight <= 0) {
    throw new Error("total weight must be positive");
  }

  // Negative totals: allocate the absolute value, then negate.
  const sign = totalCents < 0 ? -1 : 1;
  const absTotal = Math.abs(totalCents);

  // Integer math: floor share = floor(absTotal * weight / totalWeight),
  // remainder = (absTotal * weight) mod totalWeight — both exact via BigInt
  // to avoid overflow on large intermediate products.
  const bigTotal = BigInt(absTotal);
  const bigWeight = BigInt(totalWeight);
  const rows = recipients.map((r) => {
    const product = bigTotal * BigInt(r.weight);
    return {
      key: r.key,
      floor: Number(product / bigWeight),
      remainder: product % bigWeight,
    };
  });

  let leftover = absTotal - rows.reduce((s, r) => s + r.floor, 0);

  // Distribute leftover pennies: largest remainder first, ties by key asc.
  const order = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const result = new Map<string, number>();
  for (const r of rows) result.set(r.key, r.floor);
  for (let i = 0; leftover > 0; i++, leftover--) {
    const r = order[i];
    result.set(r.key, result.get(r.key)! + 1);
  }

  if (sign === -1) {
    for (const [k, v] of result) result.set(k, -v);
  }

  // Conservation check — cheap and catches every future rounding bug.
  let sum = 0;
  for (const v of result.values()) sum += v;
  if (sum !== totalCents) {
    throw new Error(
      `conservation violated: allocated ${sum}, expected ${totalCents}`,
    );
  }
  return result;
}
