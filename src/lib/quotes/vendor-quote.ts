// Upload Vendor Quote: the rules shared by the browser and the server. No server-only imports here.
//
// A vendor's quotation is read (PDF, Excel, CSV or a picture) into rows, reviewed in a popup, and the rows become lines of the quote.
//   - E / N: a row is Existing only when its item name is the name of an item of the Items module after trimming, collapsing spaces and ignoring
//     capital letters (nothing "similar" counts); otherwise it is New.
//   - The vendor's rate is kept on the line (vendorRate); the selling rate is vendor rate x (1 + profit % / 100), always worked out from the vendor's
//     rate, never from the previous selling rate, so changing the percentage again and again never compounds.
//   - A selling rate typed by hand on a line (rateManual) is left alone when the percentage changes: it was a decision of the person. "Use profit
//     percentage" on the row gives it back to the percentage.

import type { ItemDto } from "./types";

export const VENDOR_MAX_NAME = 200; // the item name of the Items module is 200 characters at most
export const VENDOR_MAX_DESCRIPTION = 2000;
export const VENDOR_MAX_RATE = 99_999_999.99;
export const VENDOR_MAX_QUANTITY = 99_999_999.99;
export const MAX_PROFIT_PERCENT = 1000;

/** One row of the review popup, as typed (text), so a half-typed number is never turned into something else */
export type VendorRow = {
  key: string;
  name: string;
  description: string;
  quantity: string;
  rate: string; // the vendor's rate per unit
  amount: string; // the vendor's total for the row
  unit: string; // read from the file when it has one; not shown in the popup
};

/** The name as compared: no leading / trailing spaces, one space between words, no capital letters */
export const normName = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A number as typed: "1,200.50", "₹ 1200", "Rs. 5" are numbers; "12 pcs" and "abc" are not (null) */
export function strictNumber(s: string | number | null | undefined): number | null {
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  if (s === null || s === undefined) return null;
  const t = s.replace(/^\s*(?:₹|Rs\.?|INR)\s*/i, "").replace(/,/g, "").trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** The text of a number for a box: no trailing zeros, at most 4 decimals */
export const numText = (n: number): string => (Number.isFinite(n) ? String(Math.round(n * 10_000) / 10_000) : "");

/**
 * The selling rate of a vendor rate with a profit percentage: vendor x (1 + pct / 100), to the paisa.
 * 100 with 25% is 125; the amount of 2 pieces is 250.
 */
export function sellingRate(vendorRate: number, profitPercent: number): number {
  return round2((vendorRate * (100 + profitPercent)) / 100);
}

/** The profit percentage box: empty is 0; otherwise a number from 0 to 1000 with two decimals at most (null = not valid) */
export function parseProfitPercent(s: string): number | null {
  const t = s.replace(/%/g, "").trim();
  if (t === "") return 0;
  const n = strictNumber(t);
  if (n === null || n < 0 || n > MAX_PROFIT_PERCENT || Math.round(n * 100) / 100 !== n) return null;
  return n;
}

// ---------------------------------------------------------------------------
// The review popup
// ---------------------------------------------------------------------------
export type RowProblems = { name?: string; quantity?: string; rate?: string; amount?: string; description?: string };

/** What is wrong with each row (by key); a row that is fine is not in the result. Rows with nothing at all in them are ignored by the caller. */
export function validateVendorRows(rows: VendorRow[]): Record<string, RowProblems> {
  const out: Record<string, RowProblems> = {};
  for (const r of rows) {
    const p: RowProblems = {};
    const name = r.name.replace(/\s+/g, " ").trim();
    if (!name) p.name = "Item name is missing";
    else if (name.length > VENDOR_MAX_NAME) p.name = `The item name can be ${VENDOR_MAX_NAME} characters long at most`;
    if (r.description.trim().length > VENDOR_MAX_DESCRIPTION) p.description = `The description can be ${VENDOR_MAX_DESCRIPTION} characters long at most`;
    const q = strictNumber(r.quantity);
    if (q === null) p.quantity = r.quantity.trim() === "" ? "Quantity is missing" : "Quantity must be a number";
    else if (q <= 0) p.quantity = "Quantity must be more than zero";
    else if (q > VENDOR_MAX_QUANTITY || Math.round(q * 100) / 100 !== q) p.quantity = "Quantity can have two decimals at most";
    const rate = strictNumber(r.rate);
    if (rate === null) p.rate = r.rate.trim() === "" ? "Rate is missing" : "Rate must be a number";
    else if (rate < 0) p.rate = "Rate cannot be less than zero";
    else if (rate > VENDOR_MAX_RATE) p.rate = "Rate is too large";
    if (r.amount.trim() !== "") {
      const a = strictNumber(r.amount);
      if (a === null) p.amount = "Amount must be a number";
      else if (a < 0) p.amount = "Amount cannot be less than zero";
    }
    if (Object.keys(p).length) out[r.key] = p;
  }
  return out;
}

/** A row with nothing typed in it (an empty line of the table) */
export const isEmptyVendorRow = (r: VendorRow): boolean => !r.name.trim() && !r.description.trim() && !r.quantity.trim() && !r.rate.trim() && !r.amount.trim();

/**
 * After the quantity or the rate was edited the amount follows (quantity x rate); after the amount was edited the rate follows (amount / quantity).
 * Anything that is not a number yet leaves the other boxes alone.
 */
export function withEdited(row: VendorRow, field: "quantity" | "rate" | "amount", value: string): VendorRow {
  const next = { ...row, [field]: value };
  const q = strictNumber(next.quantity);
  const rate = strictNumber(next.rate);
  const amount = strictNumber(next.amount);
  if (field === "amount") {
    if (amount !== null && q !== null && q > 0) next.rate = numText(round2(amount / q));
  } else if (q !== null && rate !== null) {
    next.amount = numText(round2(q * rate));
  }
  return next;
}

// ---------------------------------------------------------------------------
// What the quote keeps on a line that came from a vendor quote
// ---------------------------------------------------------------------------
/** The two extra values of such a line (vendorRate, rateManual) as they are stored in the line's custom values; the problem when they are not valid */
export function checkVendorLineValues(custom: Record<string, unknown>): { vendorRate?: number; rateManual?: boolean; error?: string } {
  const out: { vendorRate?: number; rateManual?: boolean; error?: string } = {};
  if (custom.vendorRate !== undefined && custom.vendorRate !== null && custom.vendorRate !== "") {
    const n = strictNumber(custom.vendorRate as string | number);
    if (n === null || n < 0 || n > VENDOR_MAX_RATE) return { error: "The vendor rate must be an amount from 0 to 99,999,999.99" };
    out.vendorRate = Math.round(n * 10_000) / 10_000;
  }
  if (custom.rateManual !== undefined && custom.rateManual !== null) {
    if (typeof custom.rateManual !== "boolean") return { error: "rateManual must be true or false" };
    if (custom.rateManual && out.vendorRate !== undefined) out.rateManual = true;
  }
  return out;
}

/** The profit percentage of the quote as the body sends it: null for none; the problem when it is not valid */
export function checkProfitPercent(v: unknown): { value: number | null; error?: string } {
  if (v === undefined || v === null || v === "") return { value: null };
  const n = strictNumber(v as string | number);
  if (n === null || n < 0 || n > MAX_PROFIT_PERCENT || Math.round(n * 100) / 100 !== n) return { value: null, error: `The profit percentage must be from 0 to ${MAX_PROFIT_PERCENT} with two decimals at most` };
  return { value: n };
}

// ---------------------------------------------------------------------------
// Matching and saving the items (the answers of the two API routes)
// ---------------------------------------------------------------------------
export type VendorAction = "update" | "keep" | "add" | "quote-only";
export const EXISTING_ACTIONS: { id: VendorAction; label: string; hint: string }[] = [
  { id: "update", label: "Update Existing Items", hint: "Save the corrected description and the vendor rate (as the cost price) in the Items module" },
  { id: "keep", label: "Keep Existing Items Unchanged", hint: "The Items module stays as it is; the corrected values are used in this quote only" },
];
export const NEW_ACTIONS: { id: VendorAction; label: string; hint: string }[] = [
  { id: "add", label: "Add New Items to Items", hint: "Create the items in the Items module so they can be used in future quotes" },
  { id: "quote-only", label: "Use New Items Only in This Quote", hint: "The rows stay on this quote; no item is created in the Items module" },
];

/** An item of the Items module that has the name of a row (an Existing row), as the match route answers it */
export type VendorMatch = {
  item: ItemDto;
  costPrice: number | null; // the cost price of the item (Purchase Information), when it has one
  duplicates: number; // how many items carry this name (more than one means the oldest active one is used)
};

export type VendorApplyRow = {
  key: string;
  action: VendorAction;
  itemId: string | null; // the existing item, for update / keep
  name: string;
  description: string;
  rate: number; // the vendor's rate
  sellingRate: number; // the rate of the quote line (a new item starts with it as its selling price)
  unit: string;
};
export type VendorApplyResult = {
  key: string;
  action: VendorAction;
  itemId: string | null;
  status: "updated" | "unchanged" | "created" | "reused" | "kept" | "quote-only" | "failed";
  message: string;
};
