// Quotes: list, open, create, edit, delete, status, share, send, convert and the activity of a quote. One implementation behind the
// screens and the API. What a quote form contains (fields, sections, item table columns, mandatory, hidden) comes from the Quote layout
// (Edit Page Layout); numbers, taxes and rounding come from Quote Settings.

import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ZodError, type ZodIssue } from "zod";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";
import { checkProfitPercent, checkVendorLineValues } from "./vendor-quote";
import { ServiceError } from "@/lib/users/service";
import { removeObjects } from "@/lib/leads/storage";
import { DEAL_NUMBER_PREFIX } from "@/lib/leads/constants";
import { isRealDay, todayDay } from "@/lib/leads/format";
import { getLayout } from "@/lib/records/layout";
import { bindFiles, filesOf, type FileSlot } from "@/lib/records/files";
import { buildRefs, emptyRefIds, projectTemplates, type RefIds } from "@/lib/records/lookups";
import { cleanValue, displayValue, isEmptyValue, isId, stripControl } from "@/lib/records/values";
import type { FileDto, LayoutField, ModuleLayoutDto, RecordRefs } from "@/lib/records/types";
import { needQuotes } from "./access";
import { listHeader } from "./headers";
import { calcTotals } from "./calc";
import { allocateNumber, releaseNumber } from "./numbering-server";
import { claimNewDraft, dropEditDraft, numberIsReserved } from "./draft-server";
import { loadSettings } from "./settings";
import { getCustomer } from "./lookups";
import { loadItemExtras, type ItemExtras } from "./catalog";
import {
  MAX_LINES, QUOTE_STATUSES, STATUS_ACTIONS, isQuoteStatus,
  type ActivityDto, type CalcOut, type CalcInput, type LineDto, type QuoteBody, type QuoteDto, type QuoteListData, type QuoteListParams,
  type QuoteListRow, type QuoteSettings, type QuoteStatus, type ShareInfo, type TaxInfo,
} from "./types";

type Db = Prisma.TransactionClient | typeof prisma;
const TX = { maxWait: 10_000, timeout: 20_000 };
const PAGE_SIZE = 50;
const MODULE = "quote" as const;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
// A heading row ("Living Room") between the items: it has text only, no quantity, rate or tax, and is not an item of the quote
const isHeaderRow = (l: { customFields?: unknown }) => isObject(l.customFields) && l.customFields.isHeader === true;
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const dec = (d: Prisma.Decimal | number | null | undefined): number => (d === null || d === undefined ? 0 : typeof d === "number" ? d : d.toNumber());
const dayOf = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (day: string) => new Date(`${day}T00:00:00.000Z`);
const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });
const json = (custom: Record<string, unknown>) => (Object.keys(custom).length ? (custom as Prisma.InputJsonObject) : Prisma.DbNull);
const cents = (n: number) => Math.round(n * 100);

export const HEADER_INCLUDE = {
  lineItems: { orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }] },
  createdBy: { select: { user: { select: { name: true, email: true } } } },
  salesOrders: { select: { id: true } },
} satisfies Prisma.QuoteInclude;
export type QuoteRow = Prisma.QuoteGetPayload<{ include: typeof HEADER_INCLUDE }>;
type LineRow = QuoteRow["lineItems"][number];

// ---------------------------------------------------------------------------
// Reading values out of a row
// ---------------------------------------------------------------------------
function storedValue(f: LayoutField, row: Record<string, unknown>): unknown {
  const raw = f.isSystem ? row[f.key] : isObject(row.customFields) ? row.customFields[f.key] : undefined;
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  if (typeof raw === "object" && typeof (raw as { toNumber?: unknown }).toNumber === "function") return (raw as { toNumber(): number }).toNumber();
  return raw;
}

const formFieldsOf = (layout: ModuleLayoutDto) => {
  const kinds = new Map(layout.sections.map(s => [s.id, s.kind]));
  return layout.fields.filter(f => kinds.get(f.section) === "FORM");
};
const itemColumnsOf = (layout: ModuleLayoutDto) => layout.fields.filter(f => f.section === "items");

function gatherRefIds(layout: ModuleLayoutDto, rows: Record<string, unknown>[]): RefIds {
  const ids = emptyRefIds();
  for (const f of formFieldsOf(layout)) {
    if (f.type !== "USER" && f.type !== "LOOKUP") continue;
    for (const row of rows) {
      const v = storedValue(f, row);
      if (typeof v !== "string" || !v) continue;
      if (f.type === "USER") ids.users.add(v);
      else if (f.lookup === "customer") ids.customers.add(v);
      else if (f.lookup === "project") ids.projects.add(v);
      else if (f.lookup === "deal") ids.deals.add(v);
      else if (f.lookup === "materialVendor") ids.materialVendors.add(v);
      else if (f.lookup === "serviceVendor") ids.serviceVendors.add(v);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------
export function parseQuoteListParams(sp: Record<string, string | string[] | undefined>): QuoteListParams {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const dir = one("dir");
  const status = one("status");
  const day = (k: string) => { const v = one(k); return v && isRealDay(v) ? v : undefined; };
  const customer = one("customer");
  return {
    q: stripControl(one("q") ?? "").trim().slice(0, 100) || undefined,
    status: isQuoteStatus(status) ? status : undefined,
    sort: one("sort") || undefined,
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
    page: Math.max(1, Math.min(100000, parseInt(one("page") ?? "1", 10) || 1)),
    customer: customer && isId(customer) ? customer : undefined,
    from: day("from"),
    to: day("to"),
  };
}

const TEXT_TYPES = new Set(["TEXT", "TEXTAREA", "EMAIL", "PHONE", "URL"]);

function searchClauses(layout: ModuleLayoutDto, q: string): Prisma.QuoteWhereInput[] {
  const numeric = /^-?\d+(\.\d+)?$/.test(q.replace(/,/g, "")) ? Number(q.replace(/,/g, "")) : null;
  const or: Prisma.QuoteWhereInput[] = [
    { quoteNumber: contains(q) },
    { reference: contains(q) },
    { subject: contains(q) },
    { customer: { is: { name: contains(q) } } },
    { project: { is: { name: contains(q) } } },
    { deal: { is: { OR: [{ dealNumber: contains(q) }, { title: contains(q) }] } } },
  ];
  if (numeric !== null && Math.abs(numeric) < 1e10) or.push({ amount: numeric });
  for (const f of layout.fields) {
    if (f.isSystem || !f.enabled || f.section === "items" || !TEXT_TYPES.has(f.type)) continue;
    or.push({ customFields: { path: [f.key], string_contains: q, mode: "insensitive" } });
  }
  return or;
}

function orderBy(sort: string | undefined, dir: "asc" | "desc" | undefined): Prisma.QuoteOrderByWithRelationInput[] {
  const d = dir ?? "desc";
  const tail: Prisma.QuoteOrderByWithRelationInput[] = [{ numberSeq: "desc" }, { createdAt: "desc" }];
  switch (sort) {
    case "quoteNumber": return [{ numberSeries: d }, { numberSeq: d }, { createdAt: d }];
    case "customerId": case "customer": return [{ customer: { name: d } }, ...tail];
    case "status": return [{ status: d }, ...tail];
    case "amount": return [{ amount: d }, ...tail];
    case "reference": return [{ reference: d }, ...tail];
    case "expiryDate": return [{ expiryDate: d }, ...tail];
    default: return [{ date: dir ?? "desc" }, ...tail];
  }
}

function whereOf(layout: ModuleLayoutDto, p: QuoteListParams): Prisma.QuoteWhereInput {
  const AND: Prisma.QuoteWhereInput[] = [{ deletedAt: null }];
  if (p.q) AND.push({ OR: searchClauses(layout, p.q) });
  if (p.status) AND.push({ status: p.status });
  if (p.customer) AND.push({ customerId: p.customer });
  if (p.from) AND.push({ date: { gte: toDate(p.from) } });
  if (p.to) AND.push({ date: { lte: toDate(p.to) } });
  return { AND };
}

async function queryList(layout: ModuleLayoutDto, p: QuoteListParams, window: { skip: number; take: number }) {
  const where = whereOf(layout, p);
  const [total, showing, rows, grouped] = await Promise.all([
    prisma.quote.count({ where: { deletedAt: null } }),
    prisma.quote.count({ where }),
    prisma.quote.findMany({ where, orderBy: orderBy(p.sort, p.dir), skip: window.skip, take: window.take, include: { customer: { select: { id: true, name: true } } } }),
    prisma.quote.groupBy({ by: ["status"], where: { AND: [{ deletedAt: null }, ...(p.q ? [{ OR: searchClauses(layout, p.q) }] : [])] }, _count: { _all: true } }),
  ]);
  const refs = await buildRefs(gatherRefIds(layout, rows as unknown as Record<string, unknown>[]));
  const statusCounts: Record<string, number> = {};
  for (const g of grouped) statusCounts[g.status] = g._count._all;
  return { total, showing, rows, refs, statusCounts };
}

function rowOf(layout: ModuleLayoutDto, r: Prisma.QuoteGetPayload<{ include: { customer: { select: { id: true; name: true } } } }>, refs: RecordRefs): QuoteListRow {
  const cells: Record<string, string> = {};
  for (const key of layout.columns) {
    const f = layout.fields.find(x => x.key === key);
    if (!f) continue;
    if (key === "quoteNumber") cells[key] = r.quoteNumber ?? "";
    else if (key === "status") cells[key] = r.status;
    else if (key === "amount") cells[key] = String(dec(r.amount));
    else if (key === "customerId") cells[key] = r.customer?.name ?? "";
    else cells[key] = displayValue(f, storedValue(f, r as unknown as Record<string, unknown>), refs);
  }
  return { id: r.id, number: r.quoteNumber ?? "", customer: r.customer?.name ?? "", status: r.status, total: dec(r.amount), date: dayOf(r.date) ?? "", reference: r.reference ?? "", cells };
}

export async function listQuotes(ctx: AuthContext, p: QuoteListParams): Promise<QuoteListData> {
  needQuotes(ctx, "view");
  const layout = await getLayout(MODULE);
  const { total, showing, rows, refs, statusCounts } = await queryList(layout, p, { skip: (p.page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  return { rows: rows.map(r => rowOf(layout, r, refs)), total, showing, page: p.page, pageCount: Math.max(1, Math.ceil(showing / PAGE_SIZE)), pageSize: PAGE_SIZE, statusCounts };
}

// The compact list on the left of a quote (the split view): the same search, the newest first
export async function listForSidebar(ctx: AuthContext, p: QuoteListParams) {
  const data = await listQuotes(ctx, p);
  return data;
}

function csvCell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportQuotes(ctx: AuthContext, p: QuoteListParams) {
  needQuotes(ctx, "export");
  const layout = await getLayout(MODULE);
  const { rows, refs } = await queryList(layout, p, { skip: 0, take: 10000 });
  const keys = layout.columns;
  const head = keys.map(k => listHeader(k, layout.fields.find(f => f.key === k)?.label ?? k));
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    const row = rowOf(layout, r, refs);
    lines.push(keys.map(k => (k === "amount" ? dec(r.amount).toFixed(2) : row.cells[k] ?? "")).map(csvCell).join(","));
  }
  return "﻿" + lines.join("\r\n");
}

// ---------------------------------------------------------------------------
// One quote
// ---------------------------------------------------------------------------
function taxInfoOf(settings: QuoteSettings, line: { taxId: string | null; taxName: string | null; taxRate: number | null }): TaxInfo | null {
  if (line.taxRate === null || (line.taxId === null && !line.taxName)) return null;
  const def = settings.taxes.find(t => t.id === line.taxId);
  if (def && Math.round(def.components.reduce((a, c) => a + c.rate, 0) * 1000) === Math.round(line.taxRate * 1000)) return { id: def.id, name: def.name, rate: line.taxRate, components: def.components };
  const name = line.taxName ?? "Tax";
  return { id: line.taxId ?? name, name, rate: line.taxRate, components: [{ name, rate: line.taxRate }] };
}

function lineDto(l: LineRow, x: ItemExtras): LineDto {
  return {
    id: l.id, itemId: l.itemId, name: l.name ?? l.description, description: l.name ? l.description : "", hsn: l.hsn ?? "", unit: l.unit ?? "", quantity: dec(l.quantity), rate: dec(l.rate),
    kind: l.kind === "Goods" || l.kind === "Service" ? l.kind : null, taskTemplateId: l.taskTemplateId, taskTemplateName: l.taskTemplateId ? x.templates.get(l.taskTemplateId) ?? "" : "",
    imageFileId: l.itemId ? x.images.get(l.itemId) ?? null : null,
    taxId: l.taxId, taxName: l.taxName, taxRate: l.taxRate === null ? null : dec(l.taxRate), amount: dec(l.amount), custom: isObject(l.customFields) ? (l.customFields as Record<string, unknown>) : {},
  };
}

function profitOfRow(row: QuoteRow): number | null {
  const v = isObject(row.customFields) ? row.customFields.vendorProfitPercent : null;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function calcOfRow(row: QuoteRow, settings: QuoteSettings): QuoteDto["calc"] {
  const kind = row.tdsTcsKind === "TDS" || row.tdsTcsKind === "TCS" ? row.tdsTcsKind : null;
  const list = kind === "TDS" ? settings.tds : settings.tcs;
  return {
    discountPercent: dec(row.discountPercent),
    shippingCharges: dec(row.shippingCharges),
    withholding: kind && row.tdsTcsTaxId ? { kind, taxId: row.tdsTcsTaxId, name: row.tdsTcsName ?? list.find(t => t.id === row.tdsTcsTaxId)?.name ?? kind, rate: dec(row.tdsTcsRate) } : null,
    adjustmentLabel: row.adjustmentLabel ?? "Adjustment",
    adjustment: dec(row.adjustment),
  };
}

// What was saved is what is shown: the lines and the amounts are worked out again for the breakdown (CGST / SGST), but the round off and
// the total are the saved ones, so a later change of the rounding setting never changes an old quote
function totalsOfRow(row: QuoteRow, lines: LineDto[], calc: QuoteDto["calc"], settings: QuoteSettings): CalcOut {
  const out = calcTotals({
    lines: lines.map(l => ({ quantity: l.quantity, rate: l.rate, tax: taxInfoOf(settings, l) })),
    discountPercent: calc.discountPercent,
    shipping: calc.shippingCharges,
    withholding: calc.withholding ? { kind: calc.withholding.kind, id: calc.withholding.taxId, name: calc.withholding.name, rate: calc.withholding.rate } : null,
    adjustment: calc.adjustment,
    rounding: "none",
  });
  return { ...out, roundOff: dec(row.roundOff), total: dec(row.amount) };
}

export function shareInfoOf(row: { shareToken: string | null; shareExpiresAt: Date | null }, origin: string | null): ShareInfo {
  const live = row.shareToken && (!row.shareExpiresAt || row.shareExpiresAt > new Date());
  return { token: live ? row.shareToken : null, url: live && origin ? `${origin}/q/${row.shareToken}` : null, expiresAt: live ? row.shareExpiresAt?.toISOString() ?? null : null };
}

export async function loadRow(id: string, db: Db = prisma): Promise<QuoteRow> {
  if (!isId(id)) throw new ServiceError(404, "Quote not found");
  const row = await db.quote.findFirst({ where: { id, deletedAt: null }, include: HEADER_INCLUDE });
  if (!row) throw new ServiceError(404, "Quote not found");
  return row;
}

export async function buildQuoteDto(row: QuoteRow, layout: ModuleLayoutDto, settings: QuoteSettings, origin: string | null): Promise<QuoteDto> {
  const files = await filesOf(MODULE, row.id);
  const refs = await buildRefs(gatherRefIds(layout, [row as unknown as Record<string, unknown>]));
  const values: Record<string, unknown> = {};
  for (const f of formFieldsOf(layout)) {
    if (f.type === "AUTO") values[f.key] = row.quoteNumber;
    else if (f.type === "FILE") values[f.key] = files.get(`|${f.key}`) ?? [];
    else if (f.type === "CHECKBOX") values[f.key] = f.key === "retainerInvoice" ? row.retainerInvoice : storedValue(f, row as unknown as Record<string, unknown>) === true;
    else values[f.key] = storedValue(f, row as unknown as Record<string, unknown>);
  }
  const extras = await loadItemExtras(row.lineItems.flatMap(l => (l.itemId ? [l.itemId] : [])));
  const lines = row.lineItems.map(l => lineDto(l, extras));
  const calc = calcOfRow(row, settings);
  const customer = row.customerId ? await getCustomer(row.customerId) : null;
  return {
    id: row.id, quoteNumber: row.quoteNumber ?? "", numberSeries: row.numberSeries, numberSeq: row.numberSeq, status: row.status, values, lines, calc,
    totals: totalsOfRow(row, lines, calc, settings), profitPercent: profitOfRow(row), refs, customer, files: (files.get("|attachments") ?? []) as FileDto[],
    share: shareInfoOf(row, origin), createdBy: row.createdBy?.user?.name?.trim() || row.createdBy?.user?.email || null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getQuote(ctx: AuthContext, id: string, origin: string | null = null): Promise<{ quote: QuoteDto; layout: ModuleLayoutDto; settings: QuoteSettings; salesOrders: number }> {
  needQuotes(ctx, "view");
  const [row, layout, settings] = await Promise.all([loadRow(id), getLayout(MODULE), loadSettings()]);
  return { quote: await buildQuoteDto(row, layout, settings, origin), layout, settings, salesOrders: row.salesOrders.length };
}

// ---------------------------------------------------------------------------
// Checking what the form sent
// ---------------------------------------------------------------------------
type CheckedLine = { id: string | null; data: Prisma.QuoteItemUncheckedCreateWithoutQuoteInput; out: { amount: number; taxAmount: number } };
type Checked = {
  columns: Record<string, unknown>;
  custom: Record<string, unknown>;
  slots: FileSlot[];
  lines: CheckedLine[];
  calcInput: { discountPercent: number; shipping: number; withholding: { kind: "TDS" | "TCS"; id: string; name: string; rate: number } | null; adjustmentLabel: string | null; adjustment: number };
  totals: CalcOut;
  manualNumber: string | null;
};

const issue = (path: (string | number)[], message: string): ZodIssue => ({ code: "custom", path, message });
const emptyOf = (f: LayoutField, value: unknown) => (f.type === "CHECKBOX" ? value !== true : f.type === "FILE" ? (value as unknown[]).length === 0 : isEmptyValue(value));

function numberIn(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}
const twoDecimals = (n: number) => Math.round(n * 100) / 100 === n;

// Exported so the rules can be tested without a database
export async function checkInput(ctx: AuthContext, layout: ModuleLayoutDto, settings: QuoteSettings, body: QuoteBody, existing: QuoteRow | null): Promise<Checked> {
  const issues: ZodIssue[] = [];
  const values = isObject(body.values) ? body.values : {};
  const formFields = formFieldsOf(layout);
  for (const k of Object.keys(values)) {
    if (k === "quoteNumber") continue;
    if (!formFields.some(f => f.key === k)) issues.push(issue(["values", k], "A field on this form no longer exists. Reload the page and try again."));
  }

  const out: Checked = { columns: {}, custom: {}, slots: [], lines: [], calcInput: { discountPercent: 0, shipping: 0, withholding: null, adjustmentLabel: null, adjustment: 0 }, totals: calcTotals({ lines: [], discountPercent: 0, shipping: 0, withholding: null, adjustment: 0, rounding: "none" }), manualNumber: null };
  const need = { users: new Map<string, { label: string; path: (string | number)[] }>(), customer: new Map<string, { label: string; path: (string | number)[] }>(), project: new Map<string, { label: string; path: (string | number)[] }>(), deal: new Map<string, { label: string; path: (string | number)[] }>(), materialVendor: new Map<string, { label: string; path: (string | number)[] }>(), serviceVendor: new Map<string, { label: string; path: (string | number)[] }>() };

  // A typed quote number (only when Quote Settings allow it)
  if (settings.numbering.allowManual && !existing && typeof values.quoteNumber === "string" && values.quoteNumber.trim()) {
    const n = stripControl(values.quoteNumber).trim();
    if (n.length > 60) issues.push(issue(["values", "quoteNumber"], "The quote number can be 60 characters long at most"));
    else out.manualNumber = n;
  }

  for (const f of formFields) {
    if (!f.enabled || f.type === "AUTO" || f.type === "CALC") continue;
    const path = ["values", f.key];
    if (!has(values, f.key) && existing) continue; // not sent: left as it is
    const raw = has(values, f.key) ? values[f.key] : null;
    const res = cleanValue(f, raw);
    if ("error" in res) { issues.push(issue(path, res.error)); continue; }
    if (f.required && emptyOf(f, res.value) && body.intent !== "draft") { issues.push(issue(path, `${f.label} is required`)); continue; }
    if (f.type === "FILE") { out.slots.push({ fieldKey: f.key, rowId: null, ids: res.value as string[] }); continue; }
    if (typeof res.value === "string") {
      const unchanged = !!existing && res.value === storedValue(f, existing as unknown as Record<string, unknown>);
      if (!unchanged) {
        if (f.type === "USER") need.users.set(res.value, { label: f.label, path });
        else if (f.type === "LOOKUP" && f.lookup && f.lookup in need) (need as unknown as Record<string, Map<string, { label: string; path: (string | number)[] }>>)[f.lookup].set(res.value, { label: f.label, path });
      }
    }
    const value = f.type === "CHECKBOX" ? res.value === true : f.type === "DATE" && typeof res.value === "string" ? toDate(res.value) : res.value;
    if (f.isSystem) out.columns[f.key] = value;
    else out.custom[f.key] = res.value;
  }

  // Upload Vendor Quote: the profit percentage (kept with the quote's own values; nothing is cleared by a body that does not send it)
  const profit = checkProfitPercent(body.profitPercent);
  if (profit.error) issues.push(issue(["profitPercent"], profit.error));
  else if (body.profitPercent !== undefined) out.custom.vendorProfitPercent = profit.value;

  // Item table
  const itemCols = itemColumnsOf(layout).filter(c => c.enabled && !c.isSystem && c.type !== "FILE");
  const knownCols = new Set(itemColumnsOf(layout).map(c => c.key));
  const rawLines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
  if (rawLines.length > MAX_LINES) issues.push(issue(["lines"], `A quote can have ${MAX_LINES} items at most`));
  const mine = new Map((existing?.lineItems ?? []).map(l => [l.id, l]));
  const activeTax = new Map(settings.taxes.map(t => [t.id, t]));
  const templateIds = new Set((await projectTemplates()).map(o => o.id));
  const templateColumn = itemColumnsOf(layout).find(c => c.key === "taskTemplateId");
  const calcLines: { quantity: number; rate: number; tax: TaxInfo | null }[] = [];
  let realLines = 0; // the rows that are items (a heading is not one)
  rawLines.slice(0, MAX_LINES).forEach((l, i) => {
    const at = (k: string) => ["lines", i, k];
    if (!isObject(l)) { issues.push(issue(["lines", i], "An item is not valid")); return; }
    const text = (v: unknown, max: number, what: string): string | null => {
      if (v === undefined || v === null) return "";
      if (typeof v !== "string") { issues.push(issue(at(what), "must be text")); return null; }
      const s = stripControl(v).replace(/[ \t]+/g, " ").trim();
      if (s.length > max) { issues.push(issue(at(what), `can be ${max} characters long at most`)); return null; }
      return s;
    };
    const name = text(l.name, 500, "name");
    const description = text(typeof l.description === "string" ? l.description.replace(/\r\n?/g, "\n") : l.description, 2000, "description");
    const hsn = text(l.hsn, 20, "hsn");
    const unit = text(l.unit, 20, "unit");
    const qty = l.quantity === undefined || l.quantity === null || l.quantity === "" ? 1 : numberIn(l.quantity);
    const rate = l.rate === undefined || l.rate === null || l.rate === "" ? 0 : numberIn(l.rate);
    if (name === null || description === null || hsn === null || unit === null) return;
    if (qty === null || qty < 0 || qty > 99_999_999.99 || !twoDecimals(qty)) { issues.push(issue(at("quantity"), "Quantity must be a number from 0 to 99,999,999.99 with two decimals at most")); return; }
    if (rate === null || rate < 0 || rate > 99_999_999.99 || !twoDecimals(rate)) { issues.push(issue(at("rate"), "Rate must be an amount from 0 to 99,999,999.99 with two decimals at most")); return; }
    const id = typeof l.id === "string" && l.id ? l.id : null;
    if (id && !mine.has(id)) { issues.push(issue(["lines", i], "An item no longer exists. Reload the page and try again.")); return; }
    const customIn = isObject(l.custom) ? l.custom : {};
    if (customIn.isHeader === true) {
      if (!name) return; // a heading with no text is dropped like an empty row
      calcLines.push({ quantity: 1, rate: 0, tax: null });
      out.lines.push({
        id,
        data: {
          sortOrder: out.lines.length, itemId: null, name, description: "", hsn: null, kind: null, taskTemplateId: null, unit: "", category: "General", quantity: 1, rate: 0, amount: 0,
          taxId: null, taxName: null, taxRate: null, taxAmount: 0, customFields: json({ isHeader: true }),
        },
        out: { amount: 0, taxAmount: 0 },
      });
      return;
    }
    realLines++;
    const itemId = l.itemId === undefined || l.itemId === null || l.itemId === "" ? null : isId(l.itemId) ? l.itemId : (issues.push(issue(at("itemId"), "is not valid")), null);
    const taxId = l.taxId === undefined || l.taxId === null || l.taxId === "" ? null : typeof l.taxId === "string" ? l.taxId : null;
    const tax = taxId ? activeTax.get(taxId) : undefined;
    const before = id ? mine.get(id) : undefined;
    if (taxId && (!tax || (!tax.active && before?.taxId !== taxId))) { issues.push(issue(at("taxId"), "Choose a tax from the list")); return; }
    // Goods or Service (decides HSN or SAC), and the Task Template (one of the project templates)
    const kindRaw = l.kind === undefined || l.kind === null || l.kind === "" ? null : l.kind;
    if (kindRaw !== null && kindRaw !== "Goods" && kindRaw !== "Service") { issues.push(issue(at("kind"), "must be Goods or Service")); return; }
    const kind: "Goods" | "Service" | null = kindRaw;
    const tplRaw = l.taskTemplateId === undefined || l.taskTemplateId === null || l.taskTemplateId === "" ? null : l.taskTemplateId;
    if (tplRaw !== null && typeof tplRaw !== "string") { issues.push(issue(at("taskTemplateId"), "Choose a Task Template from the list")); return; }
    let taskTemplateId: string | null = tplRaw;
    if (taskTemplateId && !templateIds.has(taskTemplateId)) {
      if (before?.taskTemplateId === taskTemplateId) taskTemplateId = null; // the template was deleted since this line was saved
      else { issues.push(issue(at("taskTemplateId"), "Choose a Task Template from the list")); return; }
    }
    for (const k of Object.keys(customIn)) {
      if (k === "isHeader" || k === "vendorRate" || k === "rateManual") continue; // isHeader: only ever "false" here (a heading was dealt with above); the other two belong to Upload Vendor Quote
      if (!knownCols.has(k)) issues.push(issue(["lines", i, "custom", k], "A column no longer exists. Reload the page and try again."));
    }
    const custom: Record<string, unknown> = {};
    const missing: LayoutField[] = [];
    let customFilled = false;
    for (const c of itemCols) {
      const res = cleanValue(c, has(customIn, c.key) ? customIn[c.key] : null);
      if ("error" in res) { issues.push(issue(["lines", i, "custom", c.key], res.error)); continue; }
      if (!emptyOf(c, res.value)) { customFilled = true; custom[c.key] = res.value; }
      else if (c.required) missing.push(c);
    }
    // Upload Vendor Quote: the vendor's rate a selling rate was worked out from, and whether the selling rate was typed by hand since
    const vendor = checkVendorLineValues(customIn);
    if (vendor.error) { issues.push(issue(["lines", i, "custom", "vendorRate"], vendor.error)); return; }
    if (vendor.vendorRate !== undefined) { custom.vendorRate = vendor.vendorRate; if (vendor.rateManual) custom.rateManual = true; }
    const blank = !name && !description && !itemId && rate === 0 && !customFilled && !hsn;
    if (blank) { realLines--; return; } // an empty row is simply dropped
    if (body.intent !== "draft") for (const c of missing) issues.push(issue(["lines", i, "custom", c.key], `${c.label} is required`));
    if (!name && body.intent !== "draft") { issues.push(issue(at("name"), "Item Details is required")); return; }
    if (templateColumn?.enabled && templateColumn.required && !taskTemplateId && body.intent !== "draft") { issues.push(issue(at("taskTemplateId"), `${templateColumn.label} is required`)); return; }
    const taxInfo: TaxInfo | null = tax ? { id: tax.id, name: tax.name, rate: tax.rate, components: tax.components } : null;
    calcLines.push({ quantity: qty, rate, tax: taxInfo });
    out.lines.push({
      id,
      data: {
        sortOrder: out.lines.length, itemId, name, description: description ?? "", hsn: hsn || null, kind, taskTemplateId, unit: unit ?? "", category: "General", quantity: qty, rate, amount: 0,
        taxId: tax ? tax.id : null, taxName: tax ? tax.name : null, taxRate: tax ? tax.rate : null, taxAmount: 0, customFields: json(custom),
      },
      out: { amount: 0, taxAmount: 0 },
    });
  });

  // Discount, shipping, TDS / TCS, adjustment
  const c: CalcInput = isObject(body.calc) ? (body.calc as CalcInput) : { discountPercent: null, shippingCharges: null, withholding: null, adjustmentLabel: null, adjustment: null };
  const num = (v: unknown, key: string, min: number, max: number, what: string, decimals: number): number => {
    if (v === undefined || v === null || v === "") return 0;
    const n = numberIn(v);
    if (n === null || n < min || n > max || Math.round(n * 10 ** decimals) / 10 ** decimals !== n) { issues.push(issue(["calc", key], `${what} must be ${min === 0 ? "" : "an amount "}from ${min} to ${max}${decimals ? ` with ${decimals} decimals at most` : ""}`)); return 0; }
    return n;
  };
  out.calcInput.discountPercent = num(c.discountPercent, "discountPercent", 0, 100, "Discount", 3);
  out.calcInput.shipping = num(c.shippingCharges, "shippingCharges", 0, 99_999_999.99, "Shipping Charges", 2);
  out.calcInput.adjustment = num(c.adjustment, "adjustment", -99_999_999.99, 99_999_999.99, "Adjustment", 2);
  if (c.adjustmentLabel !== undefined && c.adjustmentLabel !== null) {
    if (typeof c.adjustmentLabel !== "string") issues.push(issue(["calc", "adjustmentLabel"], "The adjustment name must be text"));
    else if (c.adjustmentLabel.trim().length > 60) issues.push(issue(["calc", "adjustmentLabel"], "The adjustment name can be 60 characters long at most"));
    else out.calcInput.adjustmentLabel = stripControl(c.adjustmentLabel).trim() || null;
  }
  if (c.withholding) {
    const w = c.withholding;
    const list = w.kind === "TDS" ? settings.tds : w.kind === "TCS" ? settings.tcs : null;
    const def = list?.find(t => t.id === w.taxId);
    if (!list || !def || (!def.active && !(existing && existing.tdsTcsTaxId === def.id))) issues.push(issue(["calc", "withholding"], "Choose a TDS or TCS rate from the list"));
    else out.calcInput.withholding = { kind: w.kind, id: def.id, name: def.name, rate: def.rate };
  }

  if (body.intent === "send" && realLines === 0 && !issues.length) issues.push(issue(["lines"], "Add at least one item before sending the quote"));
  if (issues.length) throw new ZodError(issues);

  // Totals: the server decides
  out.totals = calcTotals({ lines: calcLines, discountPercent: out.calcInput.discountPercent, shipping: out.calcInput.shipping, withholding: out.calcInput.withholding, adjustment: out.calcInput.adjustment, rounding: settings.rounding.mode });
  out.lines.forEach((l, i) => { l.data.amount = out.totals.lines[i].amount; l.data.taxAmount = out.totals.lines[i].tax; l.out = { amount: out.totals.lines[i].amount, taxAmount: out.totals.lines[i].tax }; });
  if (cents(out.totals.total) > 9_999_999_999_99) throw new ZodError([issue(["lines"], "The total of the quote is too large")]);

  // Everything the quote points to must exist (users active; a project and a deal belong to the customer)
  const customerId = (out.columns.customerId as string | undefined) ?? existing?.customerId ?? null;
  if (need.users.size) {
    const found = new Set((await prisma.user.findMany({ where: { id: { in: Array.from(need.users.keys()) }, status: "ACTIVE", deletedAt: null }, select: { id: true } })).map(u => u.id));
    for (const [k, v] of need.users) if (!found.has(k)) issues.push(issue(v.path, `${v.label} must be one of the active users`));
  }
  if (need.customer.size) {
    const found = new Set((await prisma.customer.findMany({ where: { id: { in: Array.from(need.customer.keys()) } }, select: { id: true } })).map(x => x.id));
    for (const [k, v] of need.customer) if (!found.has(k)) issues.push(issue(v.path, `${v.label} must be an existing customer`));
  }
  if (need.project.size) {
    const found = new Map((await prisma.project.findMany({ where: { id: { in: Array.from(need.project.keys()) } }, select: { id: true, customerId: true } })).map(x => [x.id, x.customerId]));
    for (const [k, v] of need.project) {
      if (!found.has(k)) issues.push(issue(v.path, `${v.label} must be an existing project`));
      else if (customerId && v.path[1] === "projectId" && found.get(k) !== customerId) issues.push(issue(v.path, `${v.label} must be a project of the selected customer`));
    }
  }
  if (need.deal.size) {
    const found = new Set((await prisma.deal.findMany({ where: { id: { in: Array.from(need.deal.keys()) }, deletedAt: null, dealNumber: { startsWith: DEAL_NUMBER_PREFIX } }, select: { id: true } })).map(x => x.id));
    for (const [k, v] of need.deal) {
      if (!found.has(k)) issues.push(issue(v.path, `${v.label} must be an existing deal`));
    }
  }
  if (need.materialVendor.size) {
    const found = new Set((await prisma.materialVendor.findMany({ where: { id: { in: Array.from(need.materialVendor.keys()) }, deletedAt: null }, select: { id: true } })).map(x => x.id));
    for (const [k, v] of need.materialVendor) if (!found.has(k)) issues.push(issue(v.path, `${v.label} must be an existing Material Vendor`));
  }
  if (need.serviceVendor.size) {
    const found = new Set((await prisma.serviceVendor.findMany({ where: { id: { in: Array.from(need.serviceVendor.keys()) }, deletedAt: null }, select: { id: true } })).map(x => x.id));
    for (const [k, v] of need.serviceVendor) if (!found.has(k)) issues.push(issue(v.path, `${v.label} must be an existing Service Vendor`));
  }
  const itemIds = out.lines.map(l => l.data.itemId).filter((x): x is string => !!x);
  if (itemIds.length) {
    const found = new Set((await prisma.catalogItem.findMany({ where: { id: { in: itemIds } }, select: { id: true } })).map(x => x.id));
    out.lines.forEach((l, i) => { if (l.data.itemId && !found.has(l.data.itemId)) { l.data.itemId = null; void i; } }); // an item that was deleted meanwhile: the line keeps its own copy
  }
  if (issues.length) throw new ZodError(issues);
  void ctx;
  return out;
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------
async function log(db: Db, ctx: AuthContext, quoteId: string, action: string, oldValue?: unknown, newValue?: unknown, dealId?: string | null) {
  await db.cRMAuditLog.create({
    data: {
      entityType: "Quote", entityId: quoteId, action, quoteId, performedById: ctx.employeeId, ...(dealId ? { dealId } : {}),
      oldValue: oldValue === undefined ? null : JSON.stringify(oldValue), newValue: newValue === undefined ? null : JSON.stringify(newValue),
    },
  });
}

function textOfLog(action: string, oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null, layout: ModuleLayoutDto): string {
  const label = (k: string) => (k === "customFields.vendorProfitPercent" ? "profit percentage" : layout.fields.find(f => f.key === k || f.key === k.replace(/^customFields\./, ""))?.label ?? k.replace(/^customFields\./, ""));
  switch (action) {
    case "Created": return `Quote ${newV?.quoteNumber ?? ""} created${newV?.total !== undefined ? ` (total ${Number(newV.total).toFixed(2)})` : ""}`.trim();
    case "Updated": {
      const keys = Object.keys(newV ?? {}).filter(k => k !== "lines" && k !== "total" && k !== "files");
      const parts = [...keys.map(label), ...(newV?.lines ? ["items"] : []), ...(newV?.total !== undefined ? ["total"] : []), ...(newV?.files ? ["attachments"] : [])];
      return parts.length ? `Updated ${Array.from(new Set(parts)).join(", ")}` : "Quote updated";
    }
    case "Status Changed": return `Status changed from ${oldV?.status ?? "?"} to ${newV?.status ?? "?"}`;
    case "Sent": return `Sent${newV?.to ? ` to ${newV.to}` : ""}${newV?.channel ? ` (${newV.channel})` : ""}`;
    case "Shared": return `Share link created${newV?.expiresAt ? `, valid until ${String(newV.expiresAt).slice(8, 10)}/${String(newV.expiresAt).slice(5, 7)}/${String(newV.expiresAt).slice(0, 4)}` : ""}`;
    case "Share Revoked": return "Share link switched off";
    case "Viewed": return "Opened by the customer with the share link";
    case "Converted": return `Converted to ${newV?.to ?? "another document"}`;
    case "Cloned": return `Cloned from ${oldV?.from ?? "another quote"}`;
    case "Deleted": return "Quote deleted";
    default: return action;
  }
}

export async function quoteActivity(ctx: AuthContext, id: string): Promise<ActivityDto[]> {
  needQuotes(ctx, "view");
  await loadRow(id);
  const layout = await getLayout(MODULE);
  const rows = await prisma.cRMAuditLog.findMany({
    where: { entityType: "Quote", entityId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { performedBy: { select: { user: { select: { name: true, email: true } } } } },
  });
  const parse = (s: string | null): Record<string, unknown> | null => { try { const v = s ? JSON.parse(s) : null; return isObject(v) ? v : null; } catch { return null; } };
  return rows.map(r => ({ id: r.id, action: r.action, text: textOfLog(r.action, parse(r.oldValue), parse(r.newValue), layout), by: r.performedBy?.user?.name?.trim() || r.performedBy?.user?.email || null, at: r.createdAt.toISOString() }));
}

// ---------------------------------------------------------------------------
// Create / edit / delete
// ---------------------------------------------------------------------------
function totalsColumns(c: Checked) {
  const t = c.totals;
  const w = c.calcInput.withholding;
  return {
    amount: t.total, subTotal: t.subTotal, discountPercent: c.calcInput.discountPercent, discountAmount: t.discountAmount, taxTotal: t.taxTotal,
    shippingCharges: t.shipping, tdsTcsKind: w?.kind ?? null, tdsTcsTaxId: w?.id ?? null, tdsTcsName: w?.name ?? null, tdsTcsRate: w?.rate ?? null,
    tdsTcsAmount: t.withholdingAmount, adjustmentLabel: c.calcInput.adjustmentLabel, adjustment: t.adjustment, roundOff: t.roundOff,
  };
}

// One change at a time per quote: the row stays locked until the transaction ends, and what is read afterwards is what is really there
// (two people saving the same quote at once, or converting it twice, never leave it half done)
async function lockQuote(tx: Db, id: string): Promise<{ status: string }> {
  const rows = await tx.$queryRaw<{ status: string; deletedAt: Date | null }[]>`SELECT "status", "deletedAt" FROM "Quote" WHERE "id" = ${id} FOR UPDATE`;
  const r = rows[0];
  if (!r || r.deletedAt) throw new ServiceError(404, "Quote not found");
  return { status: r.status };
}

async function writeLines(tx: Db, quoteId: string, checked: Checked, existing: { lineItems: { id: string }[] } | null) {
  const keep = new Set(checked.lines.map(l => l.id).filter((x): x is string => !!x));
  for (const old of existing?.lineItems ?? []) if (!keep.has(old.id)) await tx.quoteItem.delete({ where: { id: old.id } });
  for (const l of checked.lines) {
    if (l.id) await tx.quoteItem.update({ where: { id: l.id }, data: l.data });
    else await tx.quoteItem.create({ data: { ...l.data, quoteId } });
  }
}

function changesOf(before: Record<string, unknown>, data: Record<string, unknown>) {
  const text = (x: unknown) => (x === null || x === undefined ? null : x instanceof Date ? x.toISOString().slice(0, 10) : typeof x === "object" && typeof (x as { toNumber?: unknown }).toNumber === "function" ? String((x as { toNumber(): number }).toNumber()) : typeof x === "object" ? JSON.stringify(x) : String(x));
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (text(before[k]) !== text(v)) { from[k] = text(before[k]); to[k] = text(v); }
  return { from, to };
}

function statusFor(intent: QuoteBody["intent"], current: string | null): QuoteStatus {
  if (intent === "send") return "Sent";
  if (intent === "draft") return "Draft";
  return isQuoteStatus(current) ? current : "Draft";
}

// Somebody else changed the quote after the person started editing it: Save asks before it overwrites
export class QuoteStaleError extends ServiceError {
  constructor(message: string) {
    super(409, message);
    this.name = "QuoteStaleError";
  }
}

// `draftId`: the quote started as an auto-saved draft. Its reserved number becomes the number of the quote and the draft is deleted in the same transaction,
// so Save never makes a second record or a second number, and saving twice (a double click, two windows) saves once.
export async function createQuote(ctx: AuthContext, body: QuoteBody, draftId: string | null = null): Promise<{ id: string; quoteNumber: string; status: string }> {
  needQuotes(ctx, "create");
  const [layout, settings] = await Promise.all([getLayout(MODULE), loadSettings()]);
  const checked = await checkInput(ctx, layout, settings, body, null);
  const status = statusFor(body.intent === "save" ? "draft" : body.intent, null);
  const day = dayOf(checked.columns.date as Date | undefined) ?? (isRealDay(String(body.values?.date ?? "")) ? String(body.values.date) : todayDay());
  const removed: string[] = [];

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const created = await prisma.$transaction(async tx => {
        const reserved = draftId ? await claimNewDraft(tx, ctx, draftId) : null;
        if (checked.manualNumber && (await numberIsReserved(tx, checked.manualNumber, null))) throw new ServiceError(409, `The quote number ${checked.manualNumber} is held by a quote in progress.`);
        const num = checked.manualNumber
          ? { number: checked.manualNumber, series: null as string | null, seq: null as number | null }
          : reserved ? { number: reserved.number, series: reserved.series, seq: reserved.seq } : await allocateNumber(tx, settings.numbering, day);
        // a number typed by hand replaces the reserved one: the reserved one is given back
        if (checked.manualNumber && reserved && reserved.series !== null && reserved.seq !== null) await releaseNumber(tx, reserved.series, reserved.seq);
        const row = await tx.quote.create({
          data: {
            quoteNumber: num.number, numberSeries: num.series, numberSeq: num.seq, status, ...checked.columns, ...totalsColumns(checked),
            customFields: json(Object.fromEntries(Object.entries(checked.custom).filter(([, v]) => v !== null && v !== undefined))),
            createdById: ctx.employeeId, updatedById: ctx.userId,
          } as Prisma.QuoteUncheckedCreateInput,
          select: { id: true, quoteNumber: true, dealId: true },
        });
        await writeLines(tx, row.id, checked, null);
        removed.push(...(await bindFiles(tx, ctx, MODULE, row.id, [...checked.slots], [])));
        await log(tx, ctx, row.id, "Created", undefined, { quoteNumber: num.number, status, total: checked.totals.total, items: checked.lines.length }, row.dealId);
        if (status === "Sent") await log(tx, ctx, row.id, "Sent", undefined, { channel: "saved and sent" }, row.dealId);
        return { id: row.id, quoteNumber: row.quoteNumber ?? num.number, status };
      }, TX);
      await removeObjects(removed);
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        if (checked.manualNumber) throw new ServiceError(409, `The quote number ${checked.manualNumber} is already used.`);
        continue; // somebody typed this very number by hand: the counter moves on to the next one
      }
      throw e;
    }
  }
  throw new ServiceError(409, "Could not take a free quote number. Please try again.");
}

export async function updateQuote(ctx: AuthContext, id: string, body: QuoteBody, opts: { force?: boolean } = {}): Promise<{ id: string; quoteNumber: string; status: string }> {
  needQuotes(ctx, "edit");
  const row = await loadRow(id);
  if (row.status === "Invoiced") throw new ServiceError(409, "An invoiced quote cannot be edited.");
  // The working copy this person edited was started from an older version of the quote: somebody saved it since. Save asks before it overwrites that.
  const mine = await prisma.quoteDraft.findUnique({ where: { userId_quoteId: { userId: ctx.userId, quoteId: id } }, select: { baseUpdatedAt: true } });
  if (!opts.force && mine?.baseUpdatedAt && row.updatedAt.getTime() > mine.baseUpdatedAt.getTime()) {
    throw new QuoteStaleError("This quote was saved by someone else after you started editing it. Saving now replaces their changes with yours.");
  }
  const [layout, settings] = await Promise.all([getLayout(MODULE), loadSettings()]);
  const checked = await checkInput(ctx, layout, settings, body, row);
  let status: QuoteStatus = statusFor(body.intent, row.status);
  const removed: string[] = [];
  await prisma.$transaction(async tx => {
    const locked = await lockQuote(tx, id);
    if (locked.status === "Invoiced") throw new ServiceError(409, "An invoiced quote cannot be edited.");
    status = statusFor(body.intent, locked.status);
    const current = await tx.quoteItem.findMany({ where: { quoteId: id }, select: { id: true } });
    const present = new Set(current.map(x => x.id));
    if (checked.lines.some(l => l.id && !present.has(l.id))) throw new ServiceError(409, "Somebody else changed this quote while you were editing it. Reload the page to see their changes.");
    const custom = { ...(isObject(row.customFields) ? (row.customFields as Record<string, unknown>) : {}), ...checked.custom };
    for (const k of Object.keys(custom)) if (custom[k] === null || custom[k] === undefined) delete custom[k];
    await tx.quote.update({
      where: { id },
      data: { status, ...checked.columns, ...totalsColumns(checked), ...(Object.keys(checked.custom).length ? { customFields: json(custom) } : {}), updatedById: ctx.userId } as Prisma.QuoteUncheckedUpdateInput,
    });
    await writeLines(tx, id, checked, { lineItems: current });
    removed.push(...(await bindFiles(tx, ctx, MODULE, id, [...checked.slots], [])));
    await dropEditDraft(tx, ctx, id); // saved: the working copy of this edit is not needed any more

    const before = { ...(row as unknown as Record<string, unknown>), ...Object.fromEntries(Object.entries(isObject(row.customFields) ? row.customFields : {}).map(([k, v]) => [`customFields.${k}`, v])) };
    const changes = changesOf(before, { ...checked.columns, ...Object.fromEntries(Object.entries(checked.custom).map(([k, v]) => [`customFields.${k}`, v])) });
    const linesChanged = JSON.stringify(row.lineItems.map(l => [l.name, dec(l.quantity), dec(l.rate), l.taxId, l.description, l.taskTemplateId])) !== JSON.stringify(checked.lines.map(l => [l.data.name, l.data.quantity, l.data.rate, l.data.taxId, l.data.description, l.data.taskTemplateId ?? null]));
    const totalChanged = cents(dec(row.amount)) !== cents(checked.totals.total);
    const filesChanged = checked.slots.length > 0;
    await log(tx, ctx, id, "Updated", { ...changes.from }, { ...changes.to, ...(linesChanged ? { lines: checked.lines.length } : {}), ...(totalChanged ? { total: checked.totals.total } : {}), ...(filesChanged ? { files: true } : {}) }, (checked.columns.dealId as string | null | undefined) ?? row.dealId);
    if (status !== locked.status) await log(tx, ctx, id, "Status Changed", { status: locked.status }, { status }, row.dealId);
    if (body.intent === "send") await log(tx, ctx, id, "Sent", undefined, { channel: "saved and sent" }, row.dealId);
  }, TX);
  await removeObjects(removed);
  return { id, quoteNumber: row.quoteNumber ?? "", status };
}

export async function deleteQuote(ctx: AuthContext, id: string) {
  needQuotes(ctx, "delete");
  const row = await loadRow(id);
  if (row.status === "Invoiced") throw new ServiceError(409, "An invoiced quote cannot be deleted.");
  await prisma.$transaction(async tx => {
    if ((await lockQuote(tx, id)).status === "Invoiced") throw new ServiceError(409, "An invoiced quote cannot be deleted.");
    await tx.quote.update({ where: { id }, data: { deletedAt: new Date(), updatedById: ctx.userId, shareToken: null, shareExpiresAt: null } });
    await log(tx, ctx, id, "Deleted", { quoteNumber: row.quoteNumber }, undefined, row.dealId);
  }, TX);
  return { deleted: true, quoteNumber: row.quoteNumber ?? "" };
}

// ---------------------------------------------------------------------------
// Status, share, send, convert, clone
// ---------------------------------------------------------------------------
const TRANSITIONS: Record<string, readonly QuoteStatus[]> = STATUS_ACTIONS; // what "Mark as ..." may do from each status

export async function setQuoteStatus(ctx: AuthContext, id: string, next: string) {
  needQuotes(ctx, "edit");
  if (!isQuoteStatus(next)) throw new ServiceError(400, `Choose a status: ${QUOTE_STATUSES.join(", ")}.`);
  const row = await loadRow(id);
  if (row.status === next) return { id, status: next };
  if (!(TRANSITIONS[row.status] ?? []).includes(next)) throw new ServiceError(409, `A ${row.status.toLowerCase()} quote cannot be marked as ${next.toLowerCase()}.`);
  await prisma.$transaction(async tx => {
    const cur = await lockQuote(tx, id);
    if (cur.status === next) return;
    if (!(TRANSITIONS[cur.status] ?? []).includes(next)) throw new ServiceError(409, `A ${cur.status.toLowerCase()} quote cannot be marked as ${next.toLowerCase()}.`);
    if (next === "Declined" && (await tx.salesOrder.count({ where: { quoteId: id } })) > 0) throw new ServiceError(409, "A sales order was created from this quote, so it cannot be marked as declined.");
    await tx.quote.update({ where: { id }, data: { status: next, updatedById: ctx.userId } });
    await log(tx, ctx, id, "Status Changed", { status: cur.status }, { status: next }, row.dealId);
  }, TX);
  return { id, status: next };
}

export async function createShare(ctx: AuthContext, id: string, origin: string) {
  needQuotes(ctx, "edit");
  const row = await loadRow(id);
  const settings = await loadSettings();
  const live = row.shareToken && (!row.shareExpiresAt || row.shareExpiresAt > new Date());
  if (live) return shareInfoOf(row, origin);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + settings.templates.shareValidDays * 86_400_000);
  // Two people clicking Share at once get the same link
  const made = await prisma.$transaction(async tx => {
    await lockQuote(tx, id);
    const fresh = await tx.quote.findUnique({ where: { id }, select: { shareToken: true, shareExpiresAt: true } });
    if (fresh?.shareToken && (!fresh.shareExpiresAt || fresh.shareExpiresAt > new Date())) return fresh;
    await tx.quote.update({ where: { id }, data: { shareToken: token, shareExpiresAt: expiresAt, updatedById: ctx.userId } });
    await log(tx, ctx, id, "Shared", undefined, { expiresAt: expiresAt.toISOString() }, row.dealId);
    return { shareToken: token, shareExpiresAt: expiresAt };
  }, TX);
  return shareInfoOf(made, origin);
}

export async function revokeShare(ctx: AuthContext, id: string) {
  needQuotes(ctx, "edit");
  const row = await loadRow(id);
  if (!row.shareToken) return { revoked: false };
  await prisma.$transaction(async tx => {
    await tx.quote.update({ where: { id }, data: { shareToken: null, shareExpiresAt: null, updatedById: ctx.userId } });
    await log(tx, ctx, id, "Share Revoked", undefined, undefined, row.dealId);
  }, TX);
  return { revoked: true };
}

// "Send": the link is created, the status becomes Sent, and the activity says how it went out. There is no mail server in the CRM:
// the screen opens the person's own mail program (or WhatsApp) with the message ready, and this records that it was sent.
export async function sendQuote(ctx: AuthContext, id: string, origin: string, input: { channel: "email" | "whatsapp" | "link"; to?: string }) {
  needQuotes(ctx, "edit");
  const row = await loadRow(id);
  if (row.lineItems.every(isHeaderRow)) throw new ServiceError(409, "Add at least one item before sending the quote.");
  const share = await createShare(ctx, id, origin);
  const to = typeof input.to === "string" ? stripControl(input.to).trim().slice(0, 200) : "";
  let status = row.status;
  await prisma.$transaction(async tx => {
    const cur = await lockQuote(tx, id);
    status = cur.status;
    if (cur.status === "Draft") {
      await tx.quote.update({ where: { id }, data: { status: "Sent", updatedById: ctx.userId } });
      await log(tx, ctx, id, "Status Changed", { status: cur.status }, { status: "Sent" }, row.dealId);
      status = "Sent";
    }
    await log(tx, ctx, id, "Sent", undefined, { channel: input.channel, ...(to ? { to } : {}) }, row.dealId);
  }, TX);
  return { id, status, share };
}

export const CONVERT_TARGETS = [
  { id: "invoice", label: "Convert to Invoice" },
  { id: "salesOrder", label: "Convert to Sales Order" },
] as const;

export async function convertQuote(ctx: AuthContext, id: string, target: string) {
  needQuotes(ctx, "edit");
  const row = await loadRow(id);
  if (row.lineItems.every(isHeaderRow)) throw new ServiceError(409, "Add at least one item before converting the quote.");
  if (target === "invoice") {
    if (row.status === "Invoiced") throw new ServiceError(409, "This quote is already invoiced.");
    if (row.status === "Draft") throw new ServiceError(409, "Send the quote before converting it to an invoice.");
    if (row.status === "Declined") throw new ServiceError(409, "A declined quote cannot be converted. Mark it as accepted first.");
    await prisma.$transaction(async tx => {
      const cur = await lockQuote(tx, id);
      if (cur.status === "Invoiced") throw new ServiceError(409, "This quote is already invoiced.");
      if (cur.status === "Draft") throw new ServiceError(409, "Send the quote before converting it to an invoice.");
      if (cur.status === "Declined") throw new ServiceError(409, "A declined quote cannot be converted. Mark it as accepted first.");
      await tx.quote.update({ where: { id }, data: { status: "Invoiced", updatedById: ctx.userId } });
      await log(tx, ctx, id, "Status Changed", { status: cur.status }, { status: "Invoiced" }, row.dealId);
      await log(tx, ctx, id, "Converted", undefined, { to: row.retainerInvoice ? "an invoice (with a retainer invoice)" : "an invoice", total: dec(row.amount) }, row.dealId);
    }, TX);
    return { id, status: "Invoiced" as const, target };
  }
  if (target === "salesOrder") {
    if (row.salesOrders.length) throw new ServiceError(409, "A sales order was already created from this quote.");
    if (row.status === "Draft") throw new ServiceError(409, "Send the quote before converting it to a sales order.");
    if (row.status === "Declined") throw new ServiceError(409, "A declined quote cannot be converted. Mark it as accepted first.");
    const done = await prisma.$transaction(async tx => {
      const cur = await lockQuote(tx, id);
      if (cur.status === "Draft") throw new ServiceError(409, "Send the quote before converting it to a sales order.");
      if (cur.status === "Declined") throw new ServiceError(409, "A declined quote cannot be converted. Mark it as accepted first.");
      if (await tx.salesOrder.count({ where: { quoteId: id } })) throw new ServiceError(409, "A sales order was already created from this quote.");
      const created = await tx.salesOrder.create({ data: { quoteId: id, amount: dec(row.amount), status: "Pending" }, select: { id: true } });
      let status = cur.status;
      if (cur.status === "Sent") {
        await tx.quote.update({ where: { id }, data: { status: "Accepted", updatedById: ctx.userId } });
        await log(tx, ctx, id, "Status Changed", { status: cur.status }, { status: "Accepted" }, row.dealId);
        status = "Accepted";
      }
      await log(tx, ctx, id, "Converted", undefined, { to: "a sales order", salesOrderId: created.id }, row.dealId);
      return { created, status };
    }, TX);
    return { id, status: done.status as QuoteStatus, target, salesOrderId: done.created.id };
  }
  throw new ServiceError(400, "Choose what to convert the quote to.");
}

// A copy of a quote as a new Draft with the next number: header fields, items and totals; attachments and the share link are not copied
export async function cloneQuote(ctx: AuthContext, id: string): Promise<{ id: string; quoteNumber: string }> {
  needQuotes(ctx, "create");
  const row = await loadRow(id);
  const settings = await loadSettings();
  const today = todayDay();
  const { id: _id, quoteNumber: _n, numberSeries: _s, numberSeq: _q, status: _st, shareToken: _t, shareExpiresAt: _e, createdAt: _c, updatedAt: _u, deletedAt: _d, createdById: _cb, lineItems, createdBy: _cr, salesOrders: _so, ...rest } = row;
  void [_id, _n, _s, _q, _st, _t, _e, _c, _u, _d, _cb, _cr, _so];
  const created = await prisma.$transaction(async tx => {
    const num = await allocateNumber(tx, settings.numbering, today);
    const copy = await tx.quote.create({
      data: { ...(rest as Prisma.QuoteUncheckedCreateInput), customFields: rest.customFields === null ? Prisma.DbNull : (rest.customFields as Prisma.InputJsonValue), quoteNumber: num.number, numberSeries: num.series, numberSeq: num.seq, status: "Draft", date: toDate(today), expiryDate: null, createdById: ctx.employeeId, updatedById: ctx.userId },
      select: { id: true, quoteNumber: true },
    });
    for (const l of lineItems) {
      const { id: _lid, quoteId: _qid, createdAt: _lc, updatedAt: _lu, boqItemId: _b, customFields, ...data } = l;
      void [_lid, _qid, _lc, _lu, _b];
      await tx.quoteItem.create({ data: { ...data, quoteId: copy.id, customFields: customFields === null ? Prisma.DbNull : (customFields as Prisma.InputJsonValue) } });
    }
    await log(tx, ctx, copy.id, "Created", undefined, { quoteNumber: num.number, status: "Draft", total: dec(row.amount), items: lineItems.length }, row.dealId);
    await log(tx, ctx, copy.id, "Cloned", { from: row.quoteNumber }, undefined, row.dealId);
    return copy;
  }, TX);
  return { id: created.id, quoteNumber: created.quoteNumber ?? "" };
}
