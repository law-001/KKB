import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { computeShares, SplitError, type SplitInput } from "./split";

const sum = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0);

describe("computeShares — even", () => {
  it("₱1,200 dinner / 4 people = ₱300 each", () => {
    const r = computeShares(120000, {
      method: "even",
      participants: ["a", "b", "c", "d"],
    });
    for (const uid of ["a", "b", "c", "d"]) expect(r.get(uid)).toBe(30000);
  });

  it("₱100 / 3 conserves the total (remainder penny placed deterministically)", () => {
    const r = computeShares(10000, {
      method: "even",
      participants: ["c", "a", "b"],
    });
    expect(sum(r)).toBe(10000);
    expect(r.get("a")).toBe(3334); // tie-break: lowest userId eats the penny
  });

  it("rejects duplicate participants", () => {
    expect(() =>
      computeShares(100, { method: "even", participants: ["a", "a"] }),
    ).toThrow(SplitError);
  });
});

describe("computeShares — exact", () => {
  it("accepts allocations that sum to total", () => {
    const r = computeShares(100000, {
      method: "exact",
      allocations: [
        { userId: "mia", amountCents: 45000 },
        { userId: "alex", amountCents: 55000 },
      ],
    });
    expect(r.get("mia")).toBe(45000);
  });

  it("rejects allocations that don't sum to total", () => {
    expect(() =>
      computeShares(100000, {
        method: "exact",
        allocations: [{ userId: "mia", amountCents: 45000 }],
      }),
    ).toThrow(/sum to 45000/);
  });
});

describe("computeShares — shares & percent", () => {
  it("2:1:1 shares", () => {
    const r = computeShares(40000, {
      method: "shares",
      allocations: [
        { userId: "couple", shares: 2 },
        { userId: "s1", shares: 1 },
        { userId: "s2", shares: 1 },
      ],
    });
    expect(r.get("couple")).toBe(20000);
    expect(r.get("s1")).toBe(10000);
  });

  it("50/30/20 percent in basis points", () => {
    const r = computeShares(99999, {
      method: "percent",
      allocations: [
        { userId: "a", basisPoints: 5000 },
        { userId: "b", basisPoints: 3000 },
        { userId: "c", basisPoints: 2000 },
      ],
    });
    expect(sum(r)).toBe(99999);
  });

  it("rejects percents that don't total 10000 bp", () => {
    expect(() =>
      computeShares(100, {
        method: "percent",
        allocations: [{ userId: "a", basisPoints: 9999 }],
      }),
    ).toThrow(/9999 bp/);
  });
});

describe("computeShares — itemized", () => {
  it("'I only had a salad': proportional tip means salad person pays less tip", () => {
    // Salad 200, steak 800, tip 100 proportional → salad pays 20 tip.
    const r = computeShares(110000, {
      method: "itemized",
      items: [
        { label: "salad", amountCents: 20000, consumers: [{ userId: "sal", weight: 1 }] },
        { label: "steak", amountCents: 80000, consumers: [{ userId: "stk", weight: 1 }] },
      ],
      overheads: [
        { kind: "tip", label: "tip", amountCents: 10000, distribution: "proportional" },
      ],
    });
    expect(r.get("sal")).toBe(22000);
    expect(r.get("stk")).toBe(88000);
  });

  it("shared item with 2:1 weight ('we shared the fries but I ate more')", () => {
    const r = computeShares(9900, {
      method: "itemized",
      items: [
        {
          label: "fries",
          amountCents: 9900,
          consumers: [
            { userId: "big", weight: 2 },
            { userId: "small", weight: 1 },
          ],
        },
      ],
      overheads: [],
    });
    expect(r.get("big")).toBe(6600);
    expect(r.get("small")).toBe(3300);
  });

  it("negative discount distributes proportionally and conserves", () => {
    const r = computeShares(90000, {
      method: "itemized",
      items: [
        { label: "a", amountCents: 60000, consumers: [{ userId: "x", weight: 1 }] },
        { label: "b", amountCents: 40000, consumers: [{ userId: "y", weight: 1 }] },
      ],
      overheads: [
        { kind: "discount", label: "promo", amountCents: -10000, distribution: "proportional" },
      ],
    });
    expect(r.get("x")).toBe(54000);
    expect(r.get("y")).toBe(36000);
    expect(sum(r)).toBe(90000);
  });

  it("rejects when items + overheads don't reconcile with the total", () => {
    expect(() =>
      computeShares(100, {
        method: "itemized",
        items: [{ label: "a", amountCents: 50, consumers: [{ userId: "x", weight: 1 }] }],
        overheads: [],
      }),
    ).toThrow(/!= total/);
  });

  it("rejects positive discounts and negative tips", () => {
    const base = {
      method: "itemized" as const,
      items: [{ label: "a", amountCents: 100, consumers: [{ userId: "x", weight: 1 }] }],
    };
    expect(() =>
      computeShares(150, {
        ...base,
        overheads: [{ kind: "discount", label: "d", amountCents: 50, distribution: "even" }],
      }),
    ).toThrow(/must be negative/);
    expect(() =>
      computeShares(50, {
        ...base,
        overheads: [{ kind: "tip", label: "t", amountCents: -50, distribution: "even" }],
      }),
    ).toThrow(/must be positive/);
  });
});

describe("computeShares — adjustment (standalone IOU)", () => {
  it("assigns the whole amount to the ower", () => {
    const r = computeShares(20000, { method: "adjustment", owerId: "you" });
    expect(r.get("you")).toBe(20000);
    expect(r.size).toBe(1);
  });
});

describe("property: conservation & determinism across all methods", () => {
  const userIds = (n: number) =>
    Array.from({ length: n }, (_, i) => `u${String(i).padStart(2, "0")}`);

  it("even", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 1, max: 30 }),
        (total, n) => {
          const input: SplitInput = { method: "even", participants: userIds(n) };
          expect(sum(computeShares(total, input))).toBe(total);
        },
      ),
    );
  });

  it("shares", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.array(fc.integer({ min: 1, max: 100 }), { minLength: 1, maxLength: 20 }),
        (total, shares) => {
          const input: SplitInput = {
            method: "shares",
            allocations: shares.map((s, i) => ({ userId: `u${i}`, shares: s })),
          };
          const r1 = computeShares(total, input);
          const r2 = computeShares(total, input);
          expect(sum(r1)).toBe(total);
          expect([...r1.entries()]).toEqual([...r2.entries()]);
          for (const v of r1.values()) expect(v).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("itemized with random items, weights, and a proportional tip", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            amountCents: fc.integer({ min: 1, max: 1_000_000 }),
            consumerWeights: fc.array(fc.integer({ min: 1, max: 5 }), {
              minLength: 1,
              maxLength: 6,
            }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        fc.integer({ min: 0, max: 100_000 }),
        (items, tip) => {
          const itemInputs = items.map((it, i) => ({
            label: `item${i}`,
            amountCents: it.amountCents,
            consumers: it.consumerWeights.map((w, j) => ({
              userId: `u${j}`,
              weight: w,
            })),
          }));
          const subtotal = items.reduce((s, it) => s + it.amountCents, 0);
          const input: SplitInput = {
            method: "itemized",
            items: itemInputs,
            overheads:
              tip > 0
                ? [{ kind: "tip", label: "tip", amountCents: tip, distribution: "proportional" }]
                : [],
          };
          expect(sum(computeShares(subtotal + tip, input))).toBe(subtotal + tip);
        },
      ),
    );
  });
});
