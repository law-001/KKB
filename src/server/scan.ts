"use server";

import { requireGroupMember } from "@/lib/auth";
import { getGroup } from "@/lib/db/queries";
import {
  geminiReceiptSchema,
  scanInputSchema,
  toScanResult,
  type ScanResult,
} from "@/lib/receipt-scan";

interface ScanActionResult {
  result?: ScanResult;
  error?: string;
}

const UNREADABLE = "Couldn't read that photo — try a clearer, closer shot";

/** Gemini structured-output schema (OpenAPI subset, not zod). */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          qty: { type: "INTEGER" },
          unitPrice: { type: "STRING" },
        },
        required: ["name", "unitPrice"],
      },
    },
    overheads: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          kind: { type: "STRING", enum: ["tax", "tip", "service", "discount"] },
          label: { type: "STRING" },
          amount: { type: "STRING" },
        },
        required: ["kind", "amount"],
      },
    },
    merchant: { type: "STRING" },
    total: { type: "STRING" },
  },
  required: ["items", "overheads"],
};

function buildPrompt(currency: string) {
  return [
    "You are reading a photo of a purchase receipt.",
    "Extract every purchased line item into \"items\":",
    "- \"name\": the item description as printed, cleaned of OCR artifacts, kept short.",
    "- \"qty\": the quantity as an integer, default 1.",
    "- \"unitPrice\": the price of ONE unit as a plain decimal string with no currency symbol, e.g. \"129.50\". When a line shows a quantity and its printed amount is the total for all units, divide so that qty × unitPrice equals the printed amount. If unsure, use qty 1 with the printed line amount.",
    "Extract charge and adjustment lines into \"overheads\":",
    "- \"kind\": \"tax\" (VAT, sales tax), \"service\" (service charge), \"tip\", or \"discount\" (promos, vouchers, senior/PWD discounts).",
    "- \"amount\": a positive decimal string, even for discounts.",
    "Never include subtotal, total, cash, change, card, or other payment lines as items or overheads.",
    "If a grand total is printed, return it as \"total\". Return the store name as \"merchant\" if visible.",
    `Amounts are in ${currency}.`,
    "If the photo is not a receipt or is unreadable, return empty arrays.",
  ].join("\n");
}

export async function scanReceipt(
  groupId: string,
  rawInput: unknown,
): Promise<ScanActionResult> {
  const [, group] = await Promise.all([
    requireGroupMember(groupId),
    getGroup(groupId),
  ]);
  if (!group) return { error: "Group not found" };

  // The button only renders when the key is set, but actions are public
  // endpoints — guard at runtime too.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { error: "Receipt scanning is not configured" };

  const parsed = scanInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { error: "That image couldn't be uploaded — try a smaller photo" };
  }

  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: buildPrompt(group.currency) },
                {
                  inline_data: {
                    mime_type: parsed.data.mimeType,
                    data: parsed.data.base64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            response_mime_type: "application/json",
            response_schema: RESPONSE_SCHEMA,
          },
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") {
      return { error: "The scan took too long — try again" };
    }
    return { error: "Couldn't reach the scanner — try again" };
  }

  if (res.status === 429) {
    return { error: "The scanner is busy — wait a minute and try again" };
  }
  if (!res.ok) {
    console.error(
      `Gemini ${model} error ${res.status}: ${(await res.text()).slice(0, 500)}`,
    );
    return { error: "The scanner had a problem — try again" };
  }

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: UNREADABLE };
  }
  const receipt = geminiReceiptSchema.safeParse(json);
  if (!receipt.success) return { error: UNREADABLE };

  const result = toScanResult(receipt.data, group.currency);
  if (result.items.length === 0) {
    return {
      error: "Couldn't find any items on that photo — try again, or enter the lines by hand",
    };
  }
  return { result };
}
