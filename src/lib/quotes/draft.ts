// The working copy of a quote form (Add Quote / Edit Quote) as it is auto-saved: the form exactly as it was typed, also what is half done, so a refresh,
// a closed tab or a shut-down computer brings back the same rows with the same text. No server-only imports here: the browser builds it, the server stores it
// and checks its shape (it is the person's own typing, so nothing in it is trusted as a quote: Save checks it all again).

import type { CustomerDto } from "./types";
import type { CalcState, LineState } from "@/app/quotes/form-state";

export const DRAFT_VERSION = 1;
export const MAX_DRAFT_BYTES = 1_000_000;
export const MAX_DRAFT_LINES = 500;

/** Where the person was: the box with the cursor, the cursor itself and how far the page was scrolled */
export type DraftUi = { focusId: string | null; selStart: number | null; selEnd: number | null; scrollY: number };

export type DraftState = {
  v: typeof DRAFT_VERSION;
  values: Record<string, unknown>; // the fields of the form as the form holds them
  lines: LineState[];
  calc: CalcState;
  profitPct: string;
  manualNumber: string | null;
  customer: CustomerDto | null;
  picked: Record<string, string>; // the words shown for the people / deals / projects that were picked
  termsPick: string;
  ui: DraftUi;
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 10_000_000 ? v : null);

function lineOf(raw: unknown, at: number): LineState | null {
  if (!isObject(raw)) return null;
  const line: LineState = {
    key: str(raw.key) || `restored_${at}`,
    itemId: nullableStr(raw.itemId),
    name: str(raw.name),
    description: str(raw.description),
    hsn: str(raw.hsn),
    kind: raw.kind === "Goods" || raw.kind === "Service" ? raw.kind : "",
    taskTemplateId: str(raw.taskTemplateId),
    taskTemplateName: str(raw.taskTemplateName),
    imageFileId: nullableStr(raw.imageFileId),
    unit: str(raw.unit),
    quantity: str(raw.quantity),
    rate: str(raw.rate),
    taxId: str(raw.taxId),
    custom: isObject(raw.custom) ? raw.custom : {},
    showDesc: raw.showDesc === true,
  };
  if (typeof raw.id === "string") line.id = raw.id;
  if (raw.isHeader === true) line.isHeader = true;
  if (typeof raw.vendorRate === "string") line.vendorRate = raw.vendorRate;
  if (raw.rateManual === true) line.rateManual = true;
  return line;
}

/** The state a client sent, in the shape the form needs, or null when it is not a working copy at all (the server answers 400) */
export function parseDraftState(raw: unknown): DraftState | null {
  if (!isObject(raw) || raw.v !== DRAFT_VERSION) return null;
  if (!isObject(raw.values) || !Array.isArray(raw.lines) || !isObject(raw.calc)) return null;
  if (raw.lines.length > MAX_DRAFT_LINES || Object.keys(raw.values).length > 300) return null;
  const lines: LineState[] = [];
  for (let i = 0; i < raw.lines.length; i++) {
    const l = lineOf(raw.lines[i], i);
    if (!l) return null;
    lines.push(l);
  }
  const c = raw.calc;
  const customer = isObject(raw.customer) && typeof raw.customer.id === "string" && typeof raw.customer.name === "string" ? (raw.customer as unknown as CustomerDto) : null;
  const picked: Record<string, string> = {};
  if (isObject(raw.picked)) for (const [k, v] of Object.entries(raw.picked).slice(0, 500)) if (typeof v === "string" && k.length <= 100) picked[k] = v.slice(0, 500);
  const ui = isObject(raw.ui) ? raw.ui : {};
  return {
    v: DRAFT_VERSION,
    values: raw.values,
    lines,
    calc: { discount: str(c.discount), shipping: str(c.shipping), wKind: c.wKind === "TCS" ? "TCS" : "TDS", wTaxId: str(c.wTaxId), adjLabel: str(c.adjLabel, "Adjustment"), adjustment: str(c.adjustment) },
    profitPct: str(raw.profitPct),
    manualNumber: nullableStr(raw.manualNumber),
    customer,
    picked,
    termsPick: str(raw.termsPick),
    ui: { focusId: nullableStr(ui.focusId), selStart: int(ui.selStart), selEnd: int(ui.selEnd), scrollY: int(ui.scrollY) ?? 0 },
  };
}

const blankLine = (l: LineState) => !l.name.trim() && !l.description.trim() && !l.itemId && !(Number(l.rate) > 0) && !l.hsn.trim() && Object.keys(l.custom).length === 0;

/** A new quote gets its draft (and its number) when something has been entered; a form that was only opened does not */
export function hasMeaningfulData(s: DraftState): boolean {
  const text = (k: string) => (typeof s.values[k] === "string" ? (s.values[k] as string).trim() : "");
  return !!text("customerId") || !!text("subject") || !!text("reference") || s.lines.some(l => !blankLine(l));
}

// JSON with the keys of every object in the same order: the database keeps the keys of a stored object in its own order, so a state that went through it
// and the same state built in the browser must still give the same text
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (isObject(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

/** What the working copy holds, without where the cursor was: two states with the same signature are the same working copy */
export const draftSignature = (s: DraftState): string => stable({ ...s, ui: null });

/** What would be saved as the quote, without the keys of the rows, the words shown for what was picked and where the cursor was: two states with the same signature are the same quote */
export const changeSignature = (s: DraftState): string =>
  stable({
    values: s.values,
    lines: s.lines.map(l => ({ id: l.id ?? null, itemId: l.itemId, name: l.name, description: l.description, hsn: l.hsn, kind: l.kind, taskTemplateId: l.taskTemplateId, unit: l.unit, quantity: l.quantity, rate: l.rate, taxId: l.taxId, custom: l.custom, isHeader: l.isHeader === true, vendorRate: l.vendorRate ?? null, rateManual: l.rateManual === true })),
    calc: s.calc,
    profitPct: s.profitPct.trim(),
    manualNumber: (s.manualNumber ?? "").trim(),
    customerId: s.customer?.id ?? null,
  });

/** A line for a list of quotes in progress */
export function draftSummary(s: DraftState): { subject: string; customer: string; items: number } {
  const subject = typeof s.values.subject === "string" ? s.values.subject.trim() : "";
  return { subject, customer: s.customer?.name ?? "", items: s.lines.filter(l => !l.isHeader && !blankLine(l)).length };
}
