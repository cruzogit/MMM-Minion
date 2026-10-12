// The rules for turning one row of an import file (Pre-Payments, Payment Collections) into the columns of a record.
// Pure: the route loads the reference data (users, deals, vendors ...) and does the writing; everything that decides what a
// cell means lives here, so it can be tested without a database.
import {
  getField, looselySame, normalizeCode, normalizeStr, parseAmount, parseImportDate, pickUnique, toDateOnly, type ImportRow,
} from "@/lib/import/sheet";
import { matchUser, type ImportUser } from "@/lib/import/people";
import { cleanValue, stripControl } from "./values";
import type { FieldOption, LayoutField } from "./types";

export type { ImportUser };
export class RowError extends Error {}

// A name that two records share points to neither of them
export const AMBIGUOUS = Symbol("ambiguous");
export type RefMap = Map<string, string | typeof AMBIGUOUS>;

export function claim(map: RefMap, key: string, id: string) {
  if (!key) return;
  const held = map.get(key);
  if (held === undefined) map.set(key, id);
  else if (held !== id) map.set(key, AMBIGUOUS);
}

export type ExistingRecord = { id: string; seq: number; code: string };

export type ImportRefs = {
  users: ImportUser[];
  approvers: { id: string; label: string }[];
  deals: RefMap;
  materialVendors: RefMap;
  serviceVendors: RefMap;
  templates: RefMap;
  records: Map<string, ExistingRecord>;
  fields: LayoutField[];
};

export type ImportSettings = {
  isPre: boolean;
  idPrefix: string; // "PPR" / "PCR"
  canApprove: boolean;
  strategy: "skip" | "update" | "create_new"; // what to do with a row whose code is already a record
};

// Only what the file gave: a column that is absent (or empty) leaves the record as it is when updating, and gets a default when creating
export type Columns = {
  dealId?: string;
  taskPersonId?: string;
  paymentMode?: string;
  paymentType?: string;
  paymentStatus?: string;
  materialVendorId?: string;
  serviceVendorId?: string;
  workTypeId?: string;
  amount?: number;
  date?: Date;
  utrDate?: Date;
  utrNumber?: string;
  remarks?: string;
  approvedById?: string;
};

export type RowPlan = {
  code: string; // what the file called it ("" when it gave none)
  existing: ExistingRecord | null;
  updating: boolean; // the row changes that record (otherwise it becomes a new record)
  fileSeq: number | null; // the number in the code, when the code has this module's form (PPR12)
  columns: Columns;
  custom: Record<string, unknown>;
  warnings: string[];
};

const MAX_TEXT = 36000;

export const ALIASES = {
  code: ["Payment ID", "Collection ID", "Pre-Payment ID", "PPR ID", "PCR ID", "Record Id", "RecordId", "Code", "Transaction ID", "ID"],
  deal: ["Deals ID", "Deal ID", "Deal Number", "Deal", "Project ID", "DealID", "DealsID"],
  taskPerson: ["Task Person", "Task Person.id", "TaskPerson", "Assigned Person", "Owner", "Created By"],
  mode: ["Payment Mode", "Collection Mode", "PaymentMode", "CollectionMode", "Mode"],
  type: ["Payment Type", "Collection Type", "PaymentType", "CollectionType", "Type"],
  materialVendor: ["Material Vendor Name", "Material Vendor", "MaterialVendorName", "MaterialVendor", "Vendor Name (Material)"],
  serviceVendor: ["Service Vendor Name", "Service Vendor", "ServiceVendorName", "ServiceVendor", "Vendor Name (Service)"],
  workType: ["Work Type", "WorkType", "Template", "Work Category", "Work"],
  amount: ["Amount", "Total Amount", "Payment Amount", "Collected Amount", "Value", "Amt"],
  date: ["Date", "Payment Date", "Collection Date", "Transaction Date", "Created Date"],
  status: ["Payment Status", "Collection Status", "PaymentStatus", "CollectionStatus", "Status"],
  utrDate: ["UTR Transaction Date", "UTR Date", "UTRDate", "Transaction Date"],
  utrNumber: ["UTR / Transaction No", "UTR Number", "UTR No", "UTR", "Transaction No", "Reference Number", "UTR/Transaction No"],
  remarks: ["Remarks", "Notes", "Description", "Comments"],
  approvedBy: ["Approved By", "ApprovedBy", "Approver"],
} as const;

/** The record a code in the file points to (PPR12, ppr-12 or the record id), if there is one */
export function findExisting(records: Map<string, ExistingRecord>, code: string): ExistingRecord | null {
  if (!code) return null;
  return records.get(code.toLowerCase().trim()) ?? records.get(normalizeCode(code)) ?? null;
}

export const codeOf = (row: ImportRow) => getField(row, ...ALIASES.code);

/** True when a row has nothing a record could be made of (blank lines at the end of a sheet) */
export function isBlankRow(row: ImportRow): boolean {
  return !getField(row, ...ALIASES.code, ...ALIASES.deal, ...ALIASES.amount, ...ALIASES.date, ...ALIASES.remarks, ...ALIASES.mode);
}

// ---------------------------------------------------------------------------
// Who is meant
// ---------------------------------------------------------------------------
export { matchUser };

export function matchApprover(approvers: { id: string; label: string }[], text: string): string | null {
  const clean = text.trim();
  const norm = normalizeStr(clean);
  if (!norm) return null;
  const byId = pickUnique(approvers, u => u.id.toLowerCase() === clean.toLowerCase());
  if (byId) return byId.id;
  const exact = pickUnique(approvers, u => normalizeStr(u.label) === norm);
  if (exact) return exact.id;
  return pickUnique(approvers, u => looselySame(normalizeStr(u.label), norm))?.id ?? null;
}

// A deal, vendor or work type by its code, id, name or title; null when nothing has that name, AMBIGUOUS when two things have
function lookup(map: RefMap, text: string): string | typeof AMBIGUOUS | null {
  const clean = text.trim();
  if (!clean) return null;
  for (const key of [clean.toLowerCase(), normalizeCode(clean), normalizeStr(clean)]) {
    if (!key) continue;
    const hit = map.get(key);
    if (hit !== undefined) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Dropdowns
// ---------------------------------------------------------------------------
type Alias = { test: (norm: string) => boolean; id: string };

function aliasesFor(fieldKey: string, isPre: boolean): Alias[] {
  const has = (...words: string[]) => (norm: string) => words.some(w => norm.includes(w));
  if (fieldKey === "paymentMode") {
    return [
      { test: has("dbs", "minion"), id: "dbs_minion" },
      { test: has("cash"), id: "cash" },
      { test: has("upi", "gpay", "phonepe", "paytm"), id: "upi" },
      { test: has("cheque", "check"), id: "cheque" },
      { test: has("neft", "rtgs", "imps", "bank", "transfer"), id: "neft_rtgs_imps" },
      { test: has("card", "credit", "debit"), id: "credit_card" },
    ];
  }
  if (fieldKey === "paymentStatus") {
    return [
      { test: has("pending", "unpaid", "not paid", "unapproved", "not approved", "awaiting"), id: "pending_approval" },
      { test: has("reject"), id: "rejected" },
      { test: has("cancel"), id: "cancelled" },
      { test: has("collect", "receiv"), id: isPre ? "approved" : "collected" },
      { test: has("paid"), id: isPre ? "paid" : "collected" },
      { test: has("approv"), id: "approved" },
    ];
  }
  if (fieldKey === "paymentType") {
    return [
      { test: has("advance"), id: "advance" },
      ...(isPre
        ? [
            { test: has("material"), id: "material_payment" },
            { test: has("service"), id: "service_payment" },
            { test: has("labour", "labor"), id: "labour_payment" },
            { test: has("transport"), id: "transport" },
          ]
        : [
            { test: has("part"), id: "part_payment" },
            { test: has("final"), id: "final_payment" },
            { test: has("retention"), id: "retention_release" },
          ]),
    ];
  }
  return [];
}

/** The option the text means (by id, by label, by the usual other names), or null when nothing fits */
export function matchOption(options: FieldOption[], fieldKey: string, text: string, isPre: boolean): string | null {
  const clean = text.trim();
  const norm = normalizeStr(clean);
  if (!norm) return null;
  const byId = options.find(o => o.id.toLowerCase() === clean.toLowerCase());
  if (byId) return byId.id;
  const byLabel = pickUnique(options, o => normalizeStr(o.label) === norm);
  if (byLabel) return byLabel.id;
  for (const alias of aliasesFor(fieldKey, isPre)) {
    if (alias.test(norm) && options.some(o => o.id === alias.id)) return alias.id;
  }
  return pickUnique(options, o => looselySame(normalizeStr(o.label), norm))?.id ?? null;
}

// ---------------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------------
const dayText = (d: Date) => d.toISOString().slice(0, 10);
const YES = new Set(["yes", "y", "true", "1", "checked"]);

// A custom field of the layout, from the cell of the file: only the plain types, checked the way the form checks them
function customValue(f: LayoutField, raw: string): { value: unknown } | { error: string } | null {
  switch (f.type) {
    case "TEXT": case "TEXTAREA": case "EMAIL": case "PHONE": case "URL":
      return cleanValue(f, stripControl(raw));
    case "NUMBER": case "CURRENCY": {
      const n = parseAmount(raw);
      return n === null ? { error: `${f.label} must be a number` } : cleanValue(f, n);
    }
    case "DATE": {
      const d = parseImportDate(raw);
      return d ? cleanValue(f, dayText(toDateOnly(d))) : { error: `${f.label} must be a valid date` };
    }
    case "CHECKBOX":
      return cleanValue(f, YES.has(raw.trim().toLowerCase()) ? true : null);
    case "DROPDOWN": {
      const id = matchOption(f.options, f.key, raw, false);
      return id ? cleanValue(f, id) : { error: `${f.label} is not a valid choice` };
    }
    default:
      return null; // users, lookups, files, multi-selects ... cannot be told from a cell of text
  }
}

/**
 * What the file says about one record. Throws a RowError when the row cannot become a record at all (an unknown deal, a bad date or
 * amount); everything that can be set aside is a warning instead, so the person can see what was not understood.
 */
export function planRow(row: ImportRow, settings: ImportSettings, refs: ImportRefs): RowPlan {
  const { isPre } = settings;
  const code = codeOf(row);
  const existing = findExisting(refs.records, code);
  const updating = !!existing && settings.strategy === "update";
  const warnings: string[] = [];
  const columns: Columns = {};

  const seqMatch = code.match(new RegExp(`^${settings.idPrefix}[\\s\\-_]*(\\d{1,9})$`, "i"));
  const fileSeq = seqMatch ? parseInt(seqMatch[1], 10) : null;

  // Deal: a record belongs to one, so it has to be found, and found without doubt
  const dealRaw = getField(row, ...ALIASES.deal);
  if (dealRaw) {
    const deal = lookup(refs.deals, dealRaw);
    if (deal === AMBIGUOUS) throw new RowError(`'${dealRaw}' matches more than one deal. Use the Deals ID (for example DL12).`);
    if (!deal) throw new RowError(`Deal '${dealRaw}' was not found. Use the Deals ID (for example DL12).`);
    columns.dealId = deal;
  } else if (!updating) {
    throw new RowError("Deals ID is missing.");
  }

  // Amount
  const amountRaw = getField(row, ...ALIASES.amount);
  if (amountRaw) {
    const amount = parseAmount(amountRaw);
    if (amount === null) throw new RowError(`Amount '${amountRaw}' is not a number.`);
    if (amount <= 0) throw new RowError("Amount must be more than zero.");
    if (amount > 9_999_999_999_999.99) throw new RowError("Amount is too large.");
    columns.amount = Math.round(amount * 100) / 100;
  } else if (!updating) {
    throw new RowError("Amount is missing.");
  }

  // Dates: one that is written but is not a date stops the row (guessing "today" would put money on the wrong day)
  const dateRaw = getField(row, ...ALIASES.date);
  if (dateRaw) {
    const d = parseImportDate(dateRaw);
    if (!d) throw new RowError(`Date '${dateRaw}' is not a valid date.`);
    columns.date = toDateOnly(d);
  }
  const utrDateRaw = getField(row, ...ALIASES.utrDate);
  if (utrDateRaw) {
    const d = parseImportDate(utrDateRaw);
    if (d) columns.utrDate = toDateOnly(d);
    else warnings.push(`UTR Transaction Date '${utrDateRaw}' is not a valid date and was left empty.`);
  }

  // Task Person: the person in the file, otherwise the one who imports (set by the route)
  const personRaw = getField(row, ...ALIASES.taskPerson);
  if (personRaw) {
    const id = matchUser(refs.users, personRaw);
    if (id) columns.taskPersonId = id;
    else warnings.push(`Task Person '${personRaw}' was not found${updating ? " and was left as it was" : ", so you are the Task Person"}.`);
  }

  // Dropdowns
  const dropdown = (fieldKey: "paymentMode" | "paymentType" | "paymentStatus", raw: string, label: string, set: (id: string) => void) => {
    if (!raw) return;
    const options = refs.fields.find(f => f.key === fieldKey)?.options ?? [];
    const id = matchOption(options, fieldKey, raw, isPre);
    if (id) set(id);
    else warnings.push(`${label} '${raw}' is not one of the choices and was left ${updating ? "as it was" : "at the default"}.`);
  };
  const noun = isPre ? "Payment" : "Collection";
  dropdown("paymentMode", getField(row, ...ALIASES.mode), `${noun} Mode`, id => (columns.paymentMode = id));
  dropdown("paymentType", getField(row, ...ALIASES.type), `${noun} Type`, id => (columns.paymentType = id));
  dropdown("paymentStatus", getField(row, ...ALIASES.status), `${noun} Status`, id => (columns.paymentStatus = id));

  // Vendors and work type: a name that is not found is left empty (and said so)
  const reference = (raw: string, map: RefMap, label: string, set: (id: string) => void) => {
    if (!raw) return;
    const hit = lookup(map, raw);
    if (hit && hit !== AMBIGUOUS) set(hit);
    else warnings.push(`${label} '${raw}' ${hit === AMBIGUOUS ? "matches more than one record" : "was not found"} and was left ${updating ? "as it was" : "empty"}.`);
  };
  reference(getField(row, ...ALIASES.materialVendor), refs.materialVendors, "Material Vendor", id => (columns.materialVendorId = id));
  reference(getField(row, ...ALIASES.serviceVendor), refs.serviceVendors, "Service Vendor", id => (columns.serviceVendorId = id));
  if (isPre) reference(getField(row, ...ALIASES.workType), refs.templates, "Work Type", id => (columns.workTypeId = id));

  // Text
  const utrNumber = stripControl(getField(row, ...ALIASES.utrNumber));
  if (utrNumber) {
    if (utrNumber.length > MAX_TEXT) throw new RowError(`UTR / Transaction No must be ${MAX_TEXT} characters or fewer.`);
    columns.utrNumber = utrNumber;
  }
  const remarks = stripControl(getField(row, ...ALIASES.remarks));
  if (remarks) {
    if (remarks.length > MAX_TEXT) throw new RowError(`Remarks must be ${MAX_TEXT} characters or fewer.`);
    columns.remarks = remarks;
  }

  // Approved By: only somebody who may approve can name an approver (as in the form), and the person has to be one
  const approvedRaw = getField(row, ...ALIASES.approvedBy);
  if (approvedRaw) {
    if (!settings.canApprove) warnings.push("Approved By was ignored: you do not have permission to approve.");
    else {
      const id = matchApprover(refs.approvers, approvedRaw);
      if (id) columns.approvedById = id;
      else warnings.push(`Approved By '${approvedRaw}' is not a user who can approve and was left empty.`);
    }
  }

  // Custom fields added in Edit Page Layout
  const custom: Record<string, unknown> = {};
  for (const f of refs.fields) {
    if (f.isSystem || !f.enabled) continue;
    const raw = getField(row, f.label, f.key);
    if (!raw) continue;
    const res = customValue(f, raw);
    if (!res) continue;
    if ("error" in res) warnings.push(`${res.error}; '${raw}' was skipped.`);
    else if (res.value !== null && res.value !== undefined) custom[f.key] = res.value;
  }

  return { code, existing, updating, fileSeq, columns, custom, warnings };
}
