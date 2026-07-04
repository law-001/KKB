import { z } from "zod";
import { parseAmountToCents } from "./ledger/money";

/*
 * Shapes shared by the receipt-scan server action and the expense form.
 * The model returns money as STRINGS; parseAmountToCents is the only
 * string→cents conversion, so no floats ever touch an amount.
 */

/** What the client uploads: a downscaled JPEG (or a small original). */
export const scanInputSchema = z.object({
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "image/heic"]),
  // ~2.8M base64 chars ≈ 2.1MB of image; the client compresses far below this.
  base64: z.string().min(1).max(2_800_000),
});

export type ScanInput = z.infer<typeof scanInputSchema>;

export const OVERHEAD_KINDS = ["tax", "tip", "service", "discount"] as const;

/** The model's structured output. Amounts stay strings until parsed exactly. */
export const geminiReceiptSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string(),
        // Bad or missing qty falls back to 1 rather than failing the scan.
        qty: z.number().int().min(1).max(999).catch(1),
        unitPrice: z.string(),
      }),
    )
    .default([]),
  overheads: z
    .array(
      z.object({
        kind: z.enum(OVERHEAD_KINDS),
        label: z.string().default(""),
        amount: z.string(),
      }),
    )
    .default([]),
  merchant: z.string().nullish(),
  total: z.string().nullish(),
});

export type GeminiReceipt = z.infer<typeof geminiReceiptSchema>;

export interface ScanResult {
  items: { label: string; qty: number; unitCents: number }[];
  overheads: {
    kind: (typeof OVERHEAD_KINDS)[number];
    label: string;
    amountCents: number;
  }[];
  merchant?: string;
  totalCents?: number;
}

/**
 * The model is told to return bare decimals, but strip stray currency
 * symbols/sign noise before the strict parser rejects the whole line.
 */
function moneyToCents(raw: string, currency: string): number | null {
  return parseAmountToCents(raw.replace(/[^0-9.,\s]/g, ""), currency);
}

/** Convert the model's strings to cents, dropping lines that don't parse. */
export function toScanResult(parsed: GeminiReceipt, currency: string): ScanResult {
  const items = parsed.items.flatMap((i) => {
    const label = i.name.trim();
    const unitCents = moneyToCents(i.unitPrice, currency);
    if (!label || unitCents === null || unitCents <= 0) return [];
    return [{ label, qty: i.qty, unitCents }];
  });
  const overheads = parsed.overheads.flatMap((o) => {
    const amountCents = moneyToCents(o.amount, currency);
    if (amountCents === null || amountCents <= 0) return [];
    return [{ kind: o.kind, label: o.label.trim(), amountCents }];
  });
  const totalCents = parsed.total
    ? (moneyToCents(parsed.total, currency) ?? undefined)
    : undefined;
  return {
    items,
    overheads,
    merchant: parsed.merchant?.trim() || undefined,
    totalCents,
  };
}
