/**
 * Balance derivation. Balances are DERIVED, never stored (build plan §2/§7).
 *
 * Signs discipline (write it once, never improvise):
 *   paid into an expense      => positive delta (the group owes you)
 *   share of an expense       => negative delta (you consumed)
 *   settlement sent           => positive delta (you paid a debt down)
 *   settlement received       => negative delta
 *
 * The sum of all members' balances in a group is always exactly zero.
 */

export interface LedgerEntry {
  userId: string;
  deltaCents: number;
}

export function computeBalances(entries: LedgerEntry[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const e of entries) {
    if (!Number.isSafeInteger(e.deltaCents)) {
      throw new Error(`non-integer ledger delta for ${e.userId}`);
    }
    balances.set(e.userId, (balances.get(e.userId) ?? 0) + e.deltaCents);
  }
  return balances;
}

/** Runtime invariant check — call before trusting any balance set. */
export function assertZeroSum(balances: Map<string, number>): void {
  let sum = 0;
  for (const v of balances.values()) sum += v;
  if (sum !== 0) {
    throw new Error(`group balances sum to ${sum}, expected 0`);
  }
}

export interface ExpenseForPairwise {
  payers: { userId: string; amountCents: number }[];
  shares: { userId: string; amountCents: number }[];
}

export interface SettlementForPairwise {
  fromUser: string;
  toUser: string;
  amountCents: number;
}

/**
 * Pairwise-exact debts: for each expense, each non-payer owes each payer
 * proportionally to what that payer put in. Preserves "you owe *me* from
 * three dinners ago" literally, instead of netting everything into a pool.
 *
 * Returns net pairwise amounts keyed "debtor|creditor" (only positive nets,
 * one direction per pair).
 */
export function computePairwiseDebts(
  expenses: ExpenseForPairwise[],
  settlements: SettlementForPairwise[],
): Map<string, number> {
  // raw.get(`${a}|${b}`) = cents a owes b (may be offset by b owing a).
  const raw = new Map<string, number>();
  const add = (from: string, to: string, cents: number) => {
    if (from === to || cents === 0) return;
    const key = `${from}|${to}`;
    raw.set(key, (raw.get(key) ?? 0) + cents);
  };

  for (const exp of expenses) {
    const totalPaid = exp.payers.reduce((s, p) => s + p.amountCents, 0);
    if (totalPaid <= 0) continue;
    for (const share of exp.shares) {
      // Self-consumption nets out per payer below (from === to skipped),
      // so a payer's own share only creates debt toward *other* payers.
      let remaining = share.amountCents;
      for (let i = 0; i < exp.payers.length; i++) {
        const payer = exp.payers[i];
        // Largest-remainder is overkill here; deterministic proportional
        // floor with the last payer absorbing the remainder keeps pairwise
        // sums exact and stable.
        const slice =
          i === exp.payers.length - 1
            ? remaining
            : Math.floor((share.amountCents * payer.amountCents) / totalPaid);
        remaining -= slice;
        add(share.userId, payer.userId, slice);
      }
    }
  }

  for (const s of settlements) {
    add(s.fromUser, s.toUser, -s.amountCents);
  }

  // Net opposite directions: keep only the positive residual per pair.
  const net = new Map<string, number>();
  const seen = new Set<string>();
  for (const key of raw.keys()) {
    const [a, b] = key.split("|");
    const pairId = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(pairId)) continue;
    seen.add(pairId);
    const ab = raw.get(`${a}|${b}`) ?? 0;
    const ba = raw.get(`${b}|${a}`) ?? 0;
    const diff = ab - ba;
    if (diff > 0) net.set(`${a}|${b}`, diff);
    else if (diff < 0) net.set(`${b}|${a}`, -diff);
  }
  return net;
}
