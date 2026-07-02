/**
 * Display/parse helpers for integer-cent amounts. Formatting is the ONLY
 * place amounts become decimal strings; parsing is the only place strings
 * become cents. Nothing in between touches floats.
 */

/** Minor-unit exponents for currencies this app supports today. */
const MINOR_UNITS: Record<string, number> = {
  PHP: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  JPY: 0, // zero-decimal: ¥1000 is stored as 1000, not 100000
  KRW: 0,
};

export const SUPPORTED_CURRENCIES = Object.keys(MINOR_UNITS);

export function minorUnitFactor(currency: string): number {
  const exp = MINOR_UNITS[currency] ?? 2;
  return 10 ** exp;
}

export function formatCents(amountCents: number, currency: string): string {
  const exp = MINOR_UNITS[currency] ?? 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(amountCents / 10 ** exp);
}

/**
 * Parse a user-entered amount string ("1,234.56") into integer cents.
 * Returns null for anything that doesn't parse exactly (too many decimals,
 * garbage characters, negative input).
 */
export function parseAmountToCents(
  raw: string,
  currency: string,
): number | null {
  const exp = MINOR_UNITS[currency] ?? 2;
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!/^\d+(\.\d*)?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > exp) return null;
  const cents =
    parseInt(whole, 10) * 10 ** exp +
    (frac ? parseInt(frac.padEnd(exp, "0"), 10) : 0);
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}
