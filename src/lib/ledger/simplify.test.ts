import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { simplifyDebts } from "./simplify";
import { assertZeroSum, computeBalances, computePairwiseDebts } from "./balances";

describe("simplifyDebts", () => {
  it("collapses a chain: A→B 200, B→C 200 becomes A→C 200", () => {
    // Net balances: A = -200, B = 0, C = +200
    const transfers = simplifyDebts(
      new Map([
        ["A", -20000],
        ["B", 0],
        ["C", 20000],
      ]),
    );
    expect(transfers).toEqual([{ from: "A", to: "C", amountCents: 20000 }]);
  });

  it("everyone at zero → empty plan", () => {
    expect(simplifyDebts(new Map([["a", 0], ["b", 0]]))).toEqual([]);
  });

  it("one creditor, many small debtors", () => {
    const transfers = simplifyDebts(
      new Map([
        ["big", 300],
        ["d1", -100],
        ["d2", -100],
        ["d3", -100],
      ]),
    );
    expect(transfers).toHaveLength(3);
    expect(transfers.every((t) => t.to === "big")).toBe(true);
  });

  it("rejects balances that don't sum to zero", () => {
    expect(() => simplifyDebts(new Map([["a", 1]]))).toThrow();
  });

  it("property: transfers zero all balances, count ≤ n-1, amounts positive", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 25,
        }),
        (raw) => {
          // Force zero-sum by making the last member absorb the imbalance.
          const balances = new Map<string, number>();
          let running = 0;
          raw.forEach((v, i) => {
            balances.set(`u${i}`, v);
            running += v;
          });
          balances.set("absorber", -running || 0); // || 0 normalizes -0

          const transfers = simplifyDebts(balances);

          const after = new Map(balances);
          for (const t of transfers) {
            expect(t.amountCents).toBeGreaterThan(0);
            expect(t.from).not.toBe(t.to);
            after.set(t.from, after.get(t.from)! + t.amountCents);
            after.set(t.to, after.get(t.to)! - t.amountCents);
          }
          for (const v of after.values()) expect(v).toBe(0);
          expect(transfers.length).toBeLessThanOrEqual(balances.size - 1);
        },
      ),
    );
  });
});

describe("computeBalances + zero-sum invariant", () => {
  it("expense + settlement lifecycle nets to zero", () => {
    // Alex pays 900 for a 3-way even dinner with Mia and Sam (300 each),
    // then Mia settles her 300.
    const balances = computeBalances([
      { userId: "alex", deltaCents: 900 }, // paid
      { userId: "alex", deltaCents: -300 }, // own share
      { userId: "mia", deltaCents: -300 },
      { userId: "sam", deltaCents: -300 },
      { userId: "mia", deltaCents: 300 }, // settlement sent
      { userId: "alex", deltaCents: -300 }, // settlement received
    ]);
    assertZeroSum(balances);
    expect(balances.get("alex")).toBe(300); // still owed by Sam
    expect(balances.get("mia")).toBe(0);
    expect(balances.get("sam")).toBe(-300);
  });
});

describe("computePairwiseDebts", () => {
  it("non-payers owe the payer directly", () => {
    const net = computePairwiseDebts(
      [
        {
          payers: [{ userId: "alex", amountCents: 900 }],
          shares: [
            { userId: "alex", amountCents: 300 },
            { userId: "mia", amountCents: 300 },
            { userId: "sam", amountCents: 300 },
          ],
        },
      ],
      [],
    );
    expect(net.get("mia|alex")).toBe(300);
    expect(net.get("sam|alex")).toBe(300);
    expect(net.size).toBe(2); // alex's own share creates no self-debt
  });

  it("opposite debts across expenses net out per pair", () => {
    const net = computePairwiseDebts(
      [
        {
          payers: [{ userId: "a", amountCents: 100 }],
          shares: [{ userId: "b", amountCents: 100 }],
        },
        {
          payers: [{ userId: "b", amountCents: 60 }],
          shares: [{ userId: "a", amountCents: 60 }],
        },
      ],
      [],
    );
    expect(net.get("b|a")).toBe(40);
    expect(net.has("a|b")).toBe(false);
  });

  it("settlements reduce pairwise debt", () => {
    const net = computePairwiseDebts(
      [
        {
          payers: [{ userId: "a", amountCents: 500 }],
          shares: [{ userId: "b", amountCents: 500 }],
        },
      ],
      [{ fromUser: "b", toUser: "a", amountCents: 500 }],
    );
    expect(net.size).toBe(0);
  });

  it("multiple payers: debt splits proportionally to what each payer put in", () => {
    const net = computePairwiseDebts(
      [
        {
          payers: [
            { userId: "p1", amountCents: 600 },
            { userId: "p2", amountCents: 300 },
          ],
          shares: [
            { userId: "p1", amountCents: 300 },
            { userId: "p2", amountCents: 300 },
            { userId: "eater", amountCents: 300 },
          ],
        },
      ],
      [],
    );
    // eater owes p1 200 and p2 100 (2:1 like the payments)
    expect(net.get("eater|p1")).toBe(200);
    expect(net.get("eater|p2")).toBe(100);
  });
});
