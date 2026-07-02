/**
 * Debt simplification: turn a net balance vector (summing to zero) into a
 * minimal-ish set of transfers. Greedy: repeatedly match the largest creditor
 * with the largest debtor. Produces at most n-1 transfers.
 *
 * (Truly minimizing transfer COUNT is NP-hard — it embeds subset-sum. The
 * greedy plan is near-optimal and predictable; deliberately not going there.)
 */

export interface Transfer {
  from: string;
  to: string;
  amountCents: number;
}

export function simplifyDebts(balances: Map<string, number>): Transfer[] {
  let sum = 0;
  for (const v of balances.values()) {
    if (!Number.isSafeInteger(v)) throw new Error("non-integer balance");
    sum += v;
  }
  if (sum !== 0) throw new Error(`balances sum to ${sum}, expected 0`);

  // Sort by magnitude desc, tie-break by id asc for determinism.
  const byMagnitude = (a: [string, number], b: [string, number]) => {
    const [aid, av] = a;
    const [bid, bv] = b;
    if (Math.abs(av) !== Math.abs(bv)) return Math.abs(bv) - Math.abs(av);
    return aid < bid ? -1 : 1;
  };
  const creditors = [...balances.entries()].filter(([, v]) => v > 0).sort(byMagnitude);
  const debtors = [...balances.entries()].filter(([, v]) => v < 0).sort(byMagnitude);

  const transfers: Transfer[] = [];
  let ci = 0;
  let di = 0;
  while (ci < creditors.length && di < debtors.length) {
    const [creditor, credit] = creditors[ci];
    const [debtor, debt] = debtors[di];
    const pay = Math.min(credit, -debt);
    transfers.push({ from: debtor, to: creditor, amountCents: pay });
    creditors[ci][1] -= pay;
    debtors[di][1] += pay;
    if (creditors[ci][1] === 0) ci++;
    if (debtors[di][1] === 0) di++;
  }
  return transfers;
}
