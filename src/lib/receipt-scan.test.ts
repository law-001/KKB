import { describe, expect, it } from "vitest";
import { geminiReceiptSchema, toScanResult } from "./receipt-scan";

const receipt = (raw: unknown) => geminiReceiptSchema.parse(raw);

describe("geminiReceiptSchema", () => {
  it("defaults missing arrays and coerces bad qty to 1", () => {
    const r = receipt({
      items: [
        { name: "Sisig", unitPrice: "185.00" },
        { name: "Rice", qty: 2.5, unitPrice: "35" },
        { name: "Beer", qty: -3, unitPrice: "95" },
      ],
    });
    expect(r.overheads).toEqual([]);
    expect(r.items.map((i) => i.qty)).toEqual([1, 1, 1]);
  });
});

describe("toScanResult", () => {
  it("converts string prices to exact cents", () => {
    const r = toScanResult(
      receipt({
        items: [{ name: "Caesar salad", qty: 2, unitPrice: "129.50" }],
        overheads: [{ kind: "tax", label: "VAT", amount: "31.08" }],
        merchant: "  Mang Inasal  ",
        total: "290.08",
      }),
      "PHP",
    );
    expect(r.items).toEqual([{ label: "Caesar salad", qty: 2, unitCents: 12950 }]);
    expect(r.overheads).toEqual([{ kind: "tax", label: "VAT", amountCents: 3108 }]);
    expect(r.merchant).toBe("Mang Inasal");
    expect(r.totalCents).toBe(29008);
  });

  it("keeps discounts positive with kind discount", () => {
    const r = toScanResult(
      receipt({
        items: [{ name: "Combo", unitPrice: "500" }],
        overheads: [{ kind: "discount", label: "Senior", amount: "-100.00" }],
      }),
      "PHP",
    );
    // The sign is carried by kind, never by the amount (form negates on submit).
    expect(r.overheads).toEqual([
      { kind: "discount", label: "Senior", amountCents: 10000 },
    ]);
  });

  it("strips currency symbols and thousands separators", () => {
    const r = toScanResult(
      receipt({ items: [{ name: "Lechon", unitPrice: "₱1,234.56" }] }),
      "PHP",
    );
    expect(r.items[0].unitCents).toBe(123456);
  });

  it("drops unparseable, non-positive, and unnamed lines", () => {
    const r = toScanResult(
      receipt({
        items: [
          { name: "OK", unitPrice: "10.00" },
          { name: "garbage price", unitPrice: "12.3.4" },
          { name: "free item", unitPrice: "0" },
          { name: "   ", unitPrice: "50" },
          { name: "too many decimals", unitPrice: "1.999" },
        ],
        overheads: [{ kind: "tip", label: "", amount: "n/a" }],
        total: "abc",
      }),
      "PHP",
    );
    expect(r.items).toEqual([{ label: "OK", qty: 1, unitCents: 1000 }]);
    expect(r.overheads).toEqual([]);
    expect(r.totalCents).toBeUndefined();
  });

  it("handles zero-decimal currencies (JPY)", () => {
    const r = toScanResult(
      receipt({
        items: [
          { name: "Ramen", unitPrice: "1,200" },
          { name: "Gyoza", unitPrice: "450.50" }, // decimals invalid for JPY
        ],
      }),
      "JPY",
    );
    expect(r.items).toEqual([{ label: "Ramen", qty: 1, unitCents: 1200 }]);
  });

  it("omits merchant when blank", () => {
    const r = toScanResult(receipt({ merchant: "" }), "PHP");
    expect(r.merchant).toBeUndefined();
    expect(r.items).toEqual([]);
  });
});
