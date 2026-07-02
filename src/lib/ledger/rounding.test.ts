import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { allocateByWeights } from "./rounding";

const sum = (m: Map<string, number>) =>
  [...m.values()].reduce((a, b) => a + b, 0);

describe("allocateByWeights", () => {
  it("splits 10000 by [1,1,1] with largest-remainder pennies", () => {
    const r = allocateByWeights(10000, [
      { key: "a", weight: 1 },
      { key: "b", weight: 1 },
      { key: "c", weight: 1 },
    ]);
    // 3333.33... each; one leftover penny goes to the lowest key on a tie.
    expect([...r.values()].sort((x, y) => x - y)).toEqual([3333, 3333, 3334]);
    expect(r.get("a")).toBe(3334);
    expect(sum(r)).toBe(10000);
  });

  it("splits 100 by [2,1] (weighted shares on a small amount)", () => {
    const r = allocateByWeights(100, [
      { key: "couple", weight: 2 },
      { key: "single", weight: 1 },
    ]);
    expect(r.get("couple")).toBe(67); // 66.67 rounds up (largest remainder)
    expect(r.get("single")).toBe(33);
  });

  it("handles zero-weight recipients (they get exactly 0)", () => {
    const r = allocateByWeights(500, [
      { key: "a", weight: 1 },
      { key: "b", weight: 0 },
    ]);
    expect(r.get("a")).toBe(500);
    expect(r.get("b")).toBe(0);
  });

  it("is antisymmetric for negative totals (discounts)", () => {
    const pos = allocateByWeights(999, [
      { key: "a", weight: 3 },
      { key: "b", weight: 2 },
    ]);
    const neg = allocateByWeights(-999, [
      { key: "a", weight: 3 },
      { key: "b", weight: 2 },
    ]);
    for (const [k, v] of pos) expect(neg.get(k)).toBe(-v);
  });

  it("rejects empty recipients, zero total weight, non-integers", () => {
    expect(() => allocateByWeights(100, [])).toThrow();
    expect(() => allocateByWeights(100, [{ key: "a", weight: 0 }])).toThrow();
    expect(() => allocateByWeights(100.5, [{ key: "a", weight: 1 }])).toThrow();
    expect(() =>
      allocateByWeights(100, [{ key: "a", weight: 1.5 }]),
    ).toThrow();
    expect(() =>
      allocateByWeights(100, [
        { key: "a", weight: 1 },
        { key: "a", weight: 2 },
      ]),
    ).toThrow();
  });

  it("property: conservation + determinism + fair spread", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -10_000_000, max: 10_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), {
          minLength: 1,
          maxLength: 20,
        }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const recipients = weights.map((w, i) => ({
            key: `u${String(i).padStart(2, "0")}`,
            weight: w,
          }));
          const r1 = allocateByWeights(total, recipients);
          const r2 = allocateByWeights(total, recipients);
          // conservation
          expect(sum(r1)).toBe(total);
          // determinism
          expect([...r1.entries()]).toEqual([...r2.entries()]);
          // each share within 1 cent of exact proportion
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          for (const rec of recipients) {
            const exact = (total * rec.weight) / totalWeight;
            expect(Math.abs(r1.get(rec.key)! - exact)).toBeLessThan(1);
          }
        },
      ),
    );
  });
});
