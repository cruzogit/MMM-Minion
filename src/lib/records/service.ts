// Records of the four modules: list, open, create, edit, delete, CSV. One implementation for all of them; what differs
// (fields, columns, tables) comes from the module's definition and its Edit Page Layout.

import { Prisma } from "@prisma/client";
import { ZodError, type ZodIssue } from "zod";
import { prisma } from "@/lib/db";
import { loadAuthState, type AuthContext } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/effective";
import type { Action } from "@/lib/rbac/catalog";
import { ServiceError } from "@/lib/users/service";
import { removeObjects } from "@/lib/leads/storage";
import { DEAL_NUMBER_PREFIX } from "@/lib/leads/constants";
import { MODULES, type ModuleDef, type SystemField } from "./registry";
import { getLayout, ROW_PARENT_KEY } from "./layout";
import { bindFiles, filesOf, slotKey, type FileSlot } from "./files";
import { buildRefs, emptyRefIds, projectTemplates, type RefIds } from "./lookups";
import { cleanValue, displayValue, isEmptyValue, isId, stripControl } from "./values";
import {
  MAX_ROWS, PAGE_SIZE,
  type Abilities, type FileDto, type LayoutField, type ListData, type ListParams, type ListRow, type ModuleId, type ModuleLayoutDto,
  type RecordDto, type RecordRefs, type RecordValues, type RowDto,
} from "./types";

type Db = Prisma.TransactionClient | typeof prisma;
type Row = Record<string, unknown> & { id: string };
type Delegate = {
  findMany(args?: unknown): Promise<Row[]>;
  findFirst(args?: unknown): Promise<Row | null>;
  count(args?: unknown): Promise<number>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
  delete(args: unknown): Promise<Row>;
};
const delegate = (db: Db, name: string) => (db as unknown as Record<string, Delegate>)[name];
export const TX = { maxWait: 10_000, timeout: 20_000 };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------
export function need(ctx: AuthContext, moduleId: ModuleId, action: Action) {
  const def = MODULES[moduleId];
  if (!hasPermission(ctx.permissions, def.permission, action)) {
    throw new ServiceError(403, `You do not have permission to ${action} ${def.plural.toLowerCase()}.`);
  }
}

export function abilitiesOf(ctx: AuthContext, moduleId: ModuleId): Abilities {
  const perm = MODULES[moduleId].permission;
  const can = (a: Action) => hasPermission(ctx.permissions, perm, a);
  return { create: can("create"), edit: can("edit"), delete: can("delete"), export: can("export"), approve: can("approve"), layout: ctx.isSuperAdmin };
}

// ---------------------------------------------------------------------------
// IDs: MV1, SV1, PPR1, PCR1 ... one atomic counter row per module, taken inside the transaction that saves the record
// ---------------------------------------------------------------------------
export async function nextSeq(db: Db, key: string): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  return Number(rows[0].value);
}

// What the next record will be called (shown in the form; the real number is taken when the record is saved)
export async function peekNextCode(moduleId: ModuleId): Promise<string> {
  const def = MODULES[moduleId];
  const row = await prisma.counter.findUnique({ where: { key: def.counterKey }, select: { value: true } });
  return `${def.idPrefix}${(row?.value ?? 0) + 1}`;
}

// ---------------------------------------------------------------------------
// Reading values out of rows
// ---------------------------------------------------------------------------
const isDecimal = (v: unknown): v is { toNumber(): number } => !!v && typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function";

// The value of a field in a database row: a column for standard fields, customFields for the ones added in Edit Page Layout
function storedValue(f: LayoutField, row: Record<string, unknown>): unknown {
  const raw = f.isSystem ? row[f.key] : isObject(row.customFields) ? row.customFields[f.key] : undefined;
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10); // the DATE columns hold calendar days
  if (isDecimal(raw)) return raw.toNumber();
  return raw;
}

function toColumn(f: LayoutField, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (f.type === "DATE") return new Date(`${value}T00:00:00.000Z`);
  return value;
}

const sectionKinds = (layout: ModuleLayoutDto) => new Map(layout.sections.map(s => [s.id, s.kind]));
const formFieldsOf = (layout: ModuleLayoutDto) => {
  const kinds = sectionKinds(layout);
  return layout.fields.filter(f => kinds.get(f.section) === "FORM");
};
const columnsOfTable = (layout: ModuleLayoutDto, section: string) => layout.fields.filter(f => f.section === section);
const std = (def: ModuleDef, key: string): SystemField | undefined => def.fields.find(f => f.key === key);

function gatherRefIds(layout: ModuleLayoutDto, rows: Row[]): RefIds {
  const ids = emptyRefIds();
  const add = (f: LayoutField, row: Row) => {
    const v = storedValue(f, row);
    if (typeof v !== "string" || !v) return;
    if (f.type === "USER" || f.type === "APPROVER") ids.users.add(v);
    else if (f.type === "LOOKUP") (f.lookup === "deal" ? ids.deals : f.lookup === "materialVendor" ? ids.materialVendors : f.lookup === "template" ? ids.templates : ids.serviceVendors).add(v);
  };
  for (const f of formFieldsOf(layout)) for (const row of rows) add(f, row); // table columns never hold users or lookups
  return ids;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------
export function parseListParams(sp: Record<string, string | string[] | undefined>): ListParams {
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const dir = one("dir");
  const filters: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (!k.startsWith("f_")) continue;
    try {
      const arr = JSON.parse((Array.isArray(v) ? v[0] : v) ?? "[]");
      if (Array.isArray(arr)) filters[k.slice(2)] = arr.filter((x): x is string => isId(x)).slice(0, 50);
    } catch { /* an unreadable filter is ignored */ }
  }
  return {
    q: stripControl(one("q") ?? "").trim().slice(0, 100) || undefined,
    sort: one("sort") || undefined,
    dir: dir === "asc" || dir === "desc" ? dir : undefined,
    page: Math.max(1, Math.min(100000, parseInt(one("page") ?? "1", 10) || 1)),
    filters,
  };
}

const TEXT_TYPES = new Set(["TEXT", "TEXTAREA", "EMAIL", "PHONE", "URL"]);
const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

function searchClauses(def: ModuleDef, layout: ModuleLayoutDto, q: string): unknown[] {
  const or: unknown[] = [{ code: contains(q) }];
  const ql = q.toLowerCase();
  const numeric = /^-?\d+(\.\d+)?$/.test(q) && Math.abs(Number(q)) < 1e12 ? Number(q) : null;
  const kinds = sectionKinds(layout);
  for (const f of layout.fields) {
    if (!f.enabled) continue;
    const table = def.tables.find(t => t.section === f.section);
    if (kinds.get(f.section) === "TABLE" && !table) continue;
    const wrap = (clause: unknown) => (table ? { [table.relation]: { some: clause } } : clause);
    if (TEXT_TYPES.has(f.type)) {
      or.push(wrap(f.isSystem ? { [f.key]: contains(q) } : { customFields: { path: [f.key], string_contains: q, mode: "insensitive" } }));
    } else if (f.type === "DROPDOWN") {
      const matches = f.options.filter(o => o.label.toLowerCase().includes(ql)).map(o => o.id);
      if (!matches.length) continue;
      if (f.isSystem) or.push(wrap({ [f.key]: { in: matches } }));
      else for (const id of matches) or.push(wrap({ customFields: { path: [f.key], equals: id } }));
    } else if (!table && f.isSystem && (f.type === "NUMBER" || f.type === "CURRENCY") && numeric !== null && (!f.integer || Number.isInteger(numeric))) {
      or.push({ [f.key]: numeric });
    } else if (!table && f.isSystem && (f.type === "USER" || f.type === "APPROVER")) {
      const relation = std(def, f.key)?.relation;
      if (relation) or.push({ [relation]: { is: { name: contains(q) } } });
    } else if (!table && f.isSystem && f.type === "LOOKUP" && f.lookup) {
      if (f.lookup === "deal") or.push({ deal: { is: { OR: [{ dealNumber: contains(q) }, { title: contains(q) }, { lead: { is: { customerName: contains(q) } } }] } } });
      else if (f.lookup === "materialVendor") or.push({ materialVendor: { is: { OR: [{ code: contains(q) }, { companyName: contains(q) }] } } });
      else if (f.lookup === "serviceVendor") or.push({ serviceVendor: { is: { OR: [{ code: contains(q) }, { name: contains(q) }] } } });
      // a template (the Work Type of a PPR) is an option of the Project layout, not a row of a table: the text search does not look at it
    }
  }
  return or;
}

function filterClauses(layout: ModuleLayoutDto, filters: Record<string, string[]>): unknown[] {
  const out: unknown[] = [];
  const kinds = sectionKinds(layout);
  for (const [key, chosen] of Object.entries(filters)) {
    const f = layout.fields.find(x => x.key === key);
    if (!f || !f.enabled || kinds.get(f.section) !== "FORM" || !chosen.length) continue;
    if (f.type !== "DROPDOWN" && f.type !== "USER" && f.type !== "APPROVER") continue;
    const ids = chosen.filter(v => v !== "none");
    const none = chosen.includes("none");
    const parts: unknown[] = [];
    if (f.isSystem) {
      if (ids.length) parts.push({ [f.key]: { in: ids } });
      if (none) parts.push({ [f.key]: null });
    } else {
      for (const id of ids) parts.push({ customFields: { path: [f.key], equals: id } }); // "none" is only offered for standard fields
    }
    if (parts.length) out.push({ OR: parts });
  }
  return out;
}

function orderBy(def: ModuleDef, layout: ModuleLayoutDto, sort: string | undefined, dir: "asc" | "desc" | undefined) {
  const d = dir ?? "desc";
  const tail = { seq: "desc" as const };
  if (!sort || sort === "code") return [{ seq: dir ?? "desc" }];
  const f = layout.fields.find(x => x.key === sort);
  if (!f || !f.isSystem || !f.enabled || !f.listable) return [tail];
  if (TEXT_TYPES.has(f.type) || f.type === "NUMBER" || f.type === "CURRENCY" || f.type === "DATE") return [{ [f.key]: d }, tail];
  const relation = std(def, f.key)?.relation;
  if (!relation) return [tail];
  if (f.type === "USER" || f.type === "APPROVER") return [{ [relation]: { name: d } }, tail];
  if (f.type === "LOOKUP") return [{ [relation]: f.lookup === "deal" ? { createdAt: d } : { seq: d } }, tail];
  return [tail];
}

function cellsOf(layout: ModuleLayoutDto, row: Row, refs: RecordRefs): Record<string, string> {
  const cells: Record<string, string> = {};
  for (const key of layout.columns) {
    const f = layout.fields.find(x => x.key === key);
    if (f) cells[key] = displayValue(f, storedValue(f, row), refs);
  }
  return cells;
}

async function queryRows(def: ModuleDef, layout: ModuleLayoutDto, params: ListParams, window: { skip: number; take: number }) {
  const AND: unknown[] = [{ deletedAt: null }];
  if (params.q) AND.push({ OR: searchClauses(def, layout, params.q) });
  AND.push(...filterClauses(layout, params.filters));
  const where = { AND };
  const model = delegate(prisma, def.model);
  const [total, showing, rows] = await Promise.all([
    model.count({ where: { deletedAt: null } }),
    model.count({ where }),
    model.findMany({ where, orderBy: orderBy(def, layout, params.sort, params.dir), skip: window.skip, take: window.take }),
  ]);
  const refs = await buildRefs(gatherRefIds(layout, rows));
  return { total, showing, rows, refs };
}

export async function listRecords(ctx: AuthContext, moduleId: ModuleId, params: ListParams): Promise<ListData> {
  need(ctx, moduleId, "view");
  const def = MODULES[moduleId];
  const layout = await getLayout(moduleId);
  const page = params.page;
  const { total, showing, rows, refs } = await queryRows(def, layout, params, { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE });
  const list: ListRow[] = rows.map(r => ({ id: r.id, code: String(r.code), cells: cellsOf(layout, r, refs) }));
  return { rows: list, total, showing, page, pageCount: Math.max(1, Math.ceil(showing / PAGE_SIZE)), pageSize: PAGE_SIZE };
}

// ---------------------------------------------------------------------------
// One record
// ---------------------------------------------------------------------------
async function loadRows(def: ModuleDef, recordId: string) {
  const out: Record<string, Row[]> = {};
  for (const t of def.tables) {
    out[t.section] = await delegate(prisma, t.model).findMany({ where: { [ROW_PARENT_KEY]: recordId }, orderBy: { sortOrder: "asc" } });
  }
  return out;
}

function valueOf(f: LayoutField, row: Row, rowId: string | null, files: Map<string, FileDto[]>): unknown {
  if (f.type === "AUTO") return row.code;
  if (f.type === "FILE") return files.get(slotKey(rowId, f.key)) ?? [];
  return storedValue(f, row);
}

export async function getRecord(ctx: AuthContext, moduleId: ModuleId, id: string): Promise<{ record: RecordDto; refs: RecordRefs }> {
  need(ctx, moduleId, "view");
  const def = MODULES[moduleId];
  if (!isId(id)) throw new ServiceError(404, `${def.label} not found`);
  const layout = await getLayout(moduleId);
  const row = await delegate(prisma, def.model).findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ServiceError(404, `${def.label} not found`);
  const [tableRows, files] = await Promise.all([loadRows(def, id), filesOf(moduleId, id)]);

  const values: RecordValues = {};
  for (const f of formFieldsOf(layout)) values[f.key] = valueOf(f, row, null, files);
  const rows: Record<string, RowDto[]> = {};
  for (const t of def.tables) {
    const cols = columnsOfTable(layout, t.section);
    rows[t.section] = tableRows[t.section].map(r => ({ id: r.id, values: Object.fromEntries(cols.map(c => [c.key, valueOf(c, r, r.id, files)])) }));
  }
  const refs = await buildRefs(gatherRefIds(layout, [row]));
  return {
    record: {
      id: row.id, code: String(row.code), values, rows,
      createdAt: (row.createdAt as Date).toISOString(), updatedAt: (row.updatedAt as Date).toISOString(),
      approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : null,
    },
    refs,
  };
}

// ---------------------------------------------------------------------------
// Checking what a form sent
// ---------------------------------------------------------------------------
type CheckedRow = { id: string | null; columns: Record<string, unknown>; custom: Record<string, unknown>; slots: { fieldKey: string; ids: string[] }[] };
type Checked = {
  columns: Record<string, unknown>;
  custom: Record<string, unknown>; // null = clear
  slots: FileSlot[];
  tables: Record<string, CheckedRow[]>; // only the tables the form sent
  approved: { id: string | null } | null;
};
type Existing = { row: Row; rows: Record<string, Row[]> } | null;

const issue = (path: (string | number)[], message: string): ZodIssue => ({ code: "custom", path, message });
const emptyOf = (f: LayoutField, value: unknown) => (f.type === "CHECKBOX" ? value !== true : f.type === "FILE" ? (value as unknown[]).length === 0 : isEmptyValue(value));

async function checkInput(ctx: AuthContext, def: ModuleDef, layout: ModuleLayoutDto, body: { values?: unknown; rows?: unknown }, existing: Existing): Promise<Checked> {
  const issues: ZodIssue[] = [];
  const values = isObject(body.values) ? body.values : {};
  const formFields = formFieldsOf(layout);
  for (const k of Object.keys(values)) {
    if (!formFields.some(f => f.key === k)) issues.push(issue(["values", k], "A field on this form no longer exists. Reload the page and try again."));
  }

  const out: Checked = { columns: {}, custom: {}, slots: [], tables: {}, approved: null };
  const users = new Map<string, { label: string; path: (string | number)[] }>();
  const lookups = {
    deal: new Map<string, { label: string; path: (string | number)[] }>(),
    materialVendor: new Map<string, { label: string; path: (string | number)[] }>(),
    serviceVendor: new Map<string, { label: string; path: (string | number)[] }>(),
    template: new Map<string, { label: string; path: (string | number)[] }>(),
  };

  for (const f of formFields) {
    if (!f.enabled || f.type === "AUTO" || f.type === "APPROVER") continue;
    const path = ["values", f.key];
    let raw: unknown;
    if (f.readOnly) {
      if (existing) continue;
      raw = f.defaultValue;
    } else {
      if (!has(values, f.key) && existing) continue; // not sent: left as it is
      raw = has(values, f.key) ? values[f.key] : null;
    }
    const res = cleanValue(f, raw);
    if ("error" in res) { issues.push(issue(path, res.error)); continue; }
    if (f.required && emptyOf(f, res.value)) { issues.push(issue(path, `${f.label} is required`)); continue; }

    if (f.type === "FILE") {
      out.slots.push({ fieldKey: f.key, rowId: null, ids: res.value as string[] });
      continue;
    }
    // A user, deal or vendor that is still the same as before is not checked again: a record keeps working after its person is deactivated
    const unchanged = !!existing && res.value === storedValue(f, existing.row);
    if (typeof res.value === "string" && !unchanged) {
      if (f.type === "USER") users.set(`${f.key}:${res.value}`, { label: f.label, path });
      else if (f.type === "LOOKUP" && (f.lookup === "deal" || f.lookup === "materialVendor" || f.lookup === "serviceVendor" || f.lookup === "template")) lookups[f.lookup].set(res.value, { label: f.label, path });
    }
    if (f.isSystem) out.columns[f.key] = toColumn(f, res.value);
    else out.custom[f.key] = res.value;
  }

  // Approved By: only somebody who may approve can change it, and only to somebody who may approve
  const approver = formFields.find(f => f.type === "APPROVER" && f.enabled);
  const approverCheck: { id: string; path: (string | number)[] } | null = (() => {
    if (!approver || !has(values, approver.key)) return null;
    const raw = values[approver.key];
    const next = raw === null || raw === undefined || raw === "" ? null : typeof raw === "string" && raw.length <= 64 ? raw : undefined;
    const path = ["values", approver.key];
    if (next === undefined) { issues.push(issue(path, `${approver.label} is not valid`)); return null; }
    const before = existing ? (existing.row[approver.key] as string | null) ?? null : null;
    if (next === before) return null;
    if (!hasPermission(ctx.permissions, def.permission, "approve")) { issues.push(issue(path, `You do not have permission to change ${approver.label}`)); return null; }
    out.approved = { id: next };
    return next ? { id: next, path } : null;
  })();

  // Tables (Price Detail, Remarks, ...): a table that was sent replaces the rows of the record
  const given = isObject(body.rows) ? body.rows : {};
  for (const k of Object.keys(given)) if (!def.tables.some(t => t.section === k)) issues.push(issue(["rows", k], "A table on this form no longer exists. Reload the page and try again."));
  for (const t of def.tables) {
    const sent = has(given, t.section);
    if (!sent && existing) continue;
    const list = sent ? given[t.section] : [];
    if (!Array.isArray(list)) { issues.push(issue(["rows", t.section], "The rows are not valid")); continue; }
    if (list.length > MAX_ROWS) { issues.push(issue(["rows", t.section], `A table can have at most ${MAX_ROWS} rows`)); continue; }
    const cols = columnsOfTable(layout, t.section).filter(c => c.enabled);
    const known = new Set(columnsOfTable(layout, t.section).map(c => c.key));
    const mine = new Set((existing?.rows[t.section] ?? []).map(r => r.id));
    const kept: CheckedRow[] = [];
    list.forEach((item, i) => {
      if (!isObject(item)) { issues.push(issue(["rows", t.section, i], "A row is not valid")); return; }
      const cells = isObject(item.values) ? item.values : {};
      const id = typeof item.id === "string" && item.id ? item.id : null;
      if (id && !mine.has(id)) { issues.push(issue(["rows", t.section, i], "A row no longer exists. Reload the page and try again.")); return; }
      for (const k of Object.keys(cells)) if (!known.has(k)) issues.push(issue(["rows", t.section, i, k], "A column no longer exists. Reload the page and try again."));
      const row: CheckedRow = { id, columns: {}, custom: {}, slots: [] };
      const cleaned = new Map<string, unknown>();
      let blank = true;
      for (const c of cols) {
        const res = cleanValue(c, has(cells, c.key) ? cells[c.key] : null);
        if ("error" in res) { issues.push(issue(["rows", t.section, i, c.key], res.error)); continue; }
        cleaned.set(c.key, res.value);
        if (!emptyOf(c, res.value)) blank = false;
        if (c.type === "FILE") row.slots.push({ fieldKey: c.key, ids: res.value as string[] });
        else if (c.isSystem) row.columns[c.key] = toColumn(c, res.value);
        else row.custom[c.key] = res.value;
      }
      if (blank) return; // an empty row is simply dropped
      for (const c of cols) {
        if (cleaned.has(c.key) && c.required && emptyOf(c, cleaned.get(c.key))) issues.push(issue(["rows", t.section, i, c.key], `${c.label} is required`));
      }
      kept.push(row);
    });
    out.tables[t.section] = kept;
  }
  if (issues.length) throw new ZodError(issues);

  // Users, deals and vendors must exist (and users be active)
  const userIds = Array.from(new Set(Array.from(users.keys()).map(k => k.split(":")[1])));
  if (userIds.length) {
    const found = new Set((await prisma.user.findMany({ where: { id: { in: userIds }, status: "ACTIVE", deletedAt: null }, select: { id: true } })).map(u => u.id));
    for (const [k, v] of users) if (!found.has(k.split(":")[1])) issues.push(issue(v.path, `${v.label} must be one of the active users`));
  }
  if (lookups.deal.size) {
    const found = new Set((await prisma.deal.findMany({ where: { id: { in: Array.from(lookups.deal.keys()) }, deletedAt: null, dealNumber: { startsWith: DEAL_NUMBER_PREFIX } }, select: { id: true } })).map(d => d.id));
    for (const [id, v] of lookups.deal) if (!found.has(id)) issues.push(issue(v.path, `${v.label} must be an existing deal`));
  }
  if (lookups.materialVendor.size) {
    const found = new Set((await prisma.materialVendor.findMany({ where: { id: { in: Array.from(lookups.materialVendor.keys()) }, deletedAt: null }, select: { id: true } })).map(d => d.id));
    for (const [id, v] of lookups.materialVendor) if (!found.has(id)) issues.push(issue(v.path, `${v.label} must be an existing Material Vendor`));
  }
  if (lookups.serviceVendor.size) {
    const found = new Set((await prisma.serviceVendor.findMany({ where: { id: { in: Array.from(lookups.serviceVendor.keys()) }, deletedAt: null }, select: { id: true } })).map(d => d.id));
    for (const [id, v] of lookups.serviceVendor) if (!found.has(id)) issues.push(issue(v.path, `${v.label} must be an existing Service Vendor`));
  }
  if (lookups.template.size) {
    const known = new Set((await projectTemplates()).map(o => o.id));
    for (const [id, v] of lookups.template) if (!known.has(id)) issues.push(issue(v.path, `${v.label} must be one of the project templates`));
  }
  if (approverCheck) {
    const state = await loadAuthState(approverCheck.id);
    if (!state || state.status !== "ACTIVE" || !hasPermission(state.permissions, def.permission, "approve")) {
      issues.push(issue(approverCheck.path, "Approved By must be an active user who is allowed to approve"));
    }
  }
  if (issues.length) throw new ZodError(issues);
  return out;
}

// ---------------------------------------------------------------------------
// Create / edit / delete
// ---------------------------------------------------------------------------
export async function audit(db: Db, ctx: AuthContext, def: ModuleDef, recordId: string, action: string, oldValue?: unknown, newValue?: unknown, dealId?: string | null) {
  await db.cRMAuditLog.create({
    data: {
      entityType: def.entityType,
      entityId: recordId,
      action,
      performedById: ctx.employeeId,
      ...(dealId ? { dealId } : {}),
      oldValue: oldValue === undefined ? null : JSON.stringify(oldValue),
      newValue: newValue === undefined ? null : JSON.stringify(newValue),
    },
  });
}

// What an edit changes, for the activity log
function changesOf(before: Record<string, unknown>, data: Record<string, unknown>) {
  const text = (x: unknown) => (x === null || x === undefined ? null : x instanceof Date ? x.toISOString().slice(0, 10) : isDecimal(x) ? String(x.toNumber()) : typeof x === "object" ? JSON.stringify(x) : String(x));
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (text(before[k]) !== text(v)) { from[k] = text(before[k]); to[k] = text(v); }
  }
  return { from, to };
}

const json = (custom: Record<string, unknown>) => (Object.keys(custom).length ? (custom as Prisma.InputJsonObject) : Prisma.DbNull);

async function writeRows(tx: Db, def: ModuleDef, recordId: string, checked: Checked, existing: Existing, slots: FileSlot[]): Promise<string[]> {
  const removedRowIds: string[] = [];
  for (const t of def.tables) {
    const kept = checked.tables[t.section];
    if (!kept) continue;
    const model = delegate(tx, t.model);
    const keptIds = new Set(kept.map(r => r.id).filter((x): x is string => !!x));
    for (const old of existing?.rows[t.section] ?? []) {
      if (!keptIds.has(old.id)) { await model.delete({ where: { id: old.id } }); removedRowIds.push(old.id); }
    }
    for (let i = 0; i < kept.length; i++) {
      const r = kept[i];
      const before = r.id ? (existing?.rows[t.section] ?? []).find(x => x.id === r.id) : undefined;
      const custom = { ...(isObject(before?.customFields) ? (before!.customFields as Record<string, unknown>) : {}), ...r.custom };
      for (const k of Object.keys(custom)) if (custom[k] === null || custom[k] === undefined) delete custom[k];
      const data = { ...r.columns, sortOrder: i, customFields: json(custom) };
      const rowId = r.id
        ? (await model.update({ where: { id: r.id }, data })).id
        : (await model.create({ data: { ...data, [ROW_PARENT_KEY]: recordId } })).id;
      for (const s of r.slots) slots.push({ fieldKey: s.fieldKey, rowId, ids: s.ids });
    }
  }
  return removedRowIds;
}

export async function createRecord(ctx: AuthContext, moduleId: ModuleId, body: { values?: unknown; rows?: unknown }) {
  need(ctx, moduleId, "create");
  const def = MODULES[moduleId];
  const layout = await getLayout(moduleId);
  const checked = await checkInput(ctx, def, layout, body, null);
  const removed: string[] = [];
  const created = await prisma.$transaction(async tx => {
    const seq = await nextSeq(tx, def.counterKey); // taken last, so the counter row is locked for as short a time as possible
    const code = `${def.idPrefix}${seq}`;
    const rec = await delegate(tx, def.model).create({
      data: {
        seq, code, ...checked.columns, customFields: json(Object.fromEntries(Object.entries(checked.custom).filter(([, v]) => v !== null && v !== undefined))),
        ...(checked.approved?.id ? { approvedById: checked.approved.id, approvedAt: new Date() } : {}),
        createdById: ctx.userId, updatedById: ctx.userId,
      },
    });
    const slots: FileSlot[] = [...checked.slots];
    await writeRows(tx, def, rec.id, checked, null, slots);
    removed.push(...(await bindFiles(tx, ctx, moduleId, rec.id, slots, [])));
    await audit(tx, ctx, def, rec.id, "Created", undefined, { code, ...Object.fromEntries(Object.entries(checked.columns).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])) }, (checked.columns.dealId as string | null | undefined) ?? null);
    return { id: rec.id, code };
  }, TX);
  await removeObjects(removed);
  return created;
}

export async function updateRecord(ctx: AuthContext, moduleId: ModuleId, id: string, body: { values?: unknown; rows?: unknown }) {
  need(ctx, moduleId, "edit");
  const def = MODULES[moduleId];
  if (!isId(id)) throw new ServiceError(404, `${def.label} not found`);
  const layout = await getLayout(moduleId);
  const row = await delegate(prisma, def.model).findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ServiceError(404, `${def.label} not found`);
  const existing: Existing = { row, rows: await loadRows(def, id) };
  const checked = await checkInput(ctx, def, layout, body, existing);

  const removed: string[] = [];
  await prisma.$transaction(async tx => {
    const custom = { ...(isObject(row.customFields) ? (row.customFields as Record<string, unknown>) : {}), ...checked.custom };
    for (const k of Object.keys(custom)) if (custom[k] === null || custom[k] === undefined) delete custom[k];
    const data: Record<string, unknown> = {
      ...checked.columns,
      ...(Object.keys(checked.custom).length ? { customFields: json(custom) } : {}),
      ...(checked.approved ? { approvedById: checked.approved.id, approvedAt: checked.approved.id ? new Date() : null } : {}),
      updatedById: ctx.userId,
    };
    await delegate(tx, def.model).update({ where: { id }, data });
    const slots: FileSlot[] = [...checked.slots];
    const removedRows = await writeRows(tx, def, id, checked, existing, slots);
    removed.push(...(await bindFiles(tx, ctx, moduleId, id, slots, removedRows)));
    const oldCustom = isObject(row.customFields) ? row.customFields : {};
    const changes = changesOf(
      { ...row, ...Object.fromEntries(Object.entries(oldCustom).map(([k, v]) => [`customFields.${k}`, v])) },
      { ...checked.columns, ...(checked.approved ? { approvedById: checked.approved.id } : {}), ...Object.fromEntries(Object.entries(checked.custom).map(([k, v]) => [`customFields.${k}`, v])) },
    );
    const tablesChanged = Object.keys(checked.tables);
    await audit(tx, ctx, def, id, "Updated", { ...changes.from }, { ...changes.to, ...(tablesChanged.length ? { tablesSaved: tablesChanged } : {}) }, ((checked.columns.dealId as string | null | undefined) ?? (row.dealId as string | null | undefined)) ?? null);
  }, TX);
  await removeObjects(removed);
  return { id, code: String(row.code) };
}

export class RecordInUseError extends Error {
  constructor(public usage: { prePayments: number; paymentCollections: number }, message: string) {
    super(message);
  }
}

export async function deleteRecord(ctx: AuthContext, moduleId: ModuleId, id: string, confirm: boolean) {
  need(ctx, moduleId, "delete");
  const def = MODULES[moduleId];
  if (!isId(id)) throw new ServiceError(404, `${def.label} not found`);
  const row = await delegate(prisma, def.model).findFirst({ where: { id, deletedAt: null } });
  if (!row) throw new ServiceError(404, `${def.label} not found`);
  // A vendor that payment records point to: those keep showing it, but the Super Admin's colleague should know before it goes
  if (moduleId === "materialVendor" || moduleId === "serviceVendor") {
    const fk = moduleId === "materialVendor" ? "materialVendorId" : "serviceVendorId";
    const [prePayments, paymentCollections] = await Promise.all([
      prisma.prePayment.count({ where: { [fk]: id, deletedAt: null } }),
      prisma.paymentCollection.count({ where: { [fk]: id, deletedAt: null } }),
    ]);
    if (prePayments + paymentCollections > 0 && !confirm) {
      const parts = [
        ...(prePayments ? [`${prePayments} pre-payment record${prePayments === 1 ? "" : "s"}`] : []),
        ...(paymentCollections ? [`${paymentCollections} payment collection record${paymentCollections === 1 ? "" : "s"}`] : []),
      ];
      throw new RecordInUseError({ prePayments, paymentCollections }, `${row.code} is used by ${parts.join(" and ")}.`);
    }
  }
  await prisma.$transaction(async tx => {
    await delegate(tx, def.model).update({ where: { id }, data: { deletedAt: new Date(), updatedById: ctx.userId } });
    await audit(tx, ctx, def, id, "Deleted", { code: row.code }, undefined, (row.dealId as string | null | undefined) ?? null);
  }, TX);
  return { deleted: true, code: String(row.code) };
}

// ---------------------------------------------------------------------------
// CSV of the current search / filters
// ---------------------------------------------------------------------------
function csvCell(value: unknown) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheets run text that starts with = + - @ as a formula
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportRecords(ctx: AuthContext, moduleId: ModuleId, params: ListParams) {
  need(ctx, moduleId, "export");
  const def = MODULES[moduleId];
  const layout = await getLayout(moduleId);
  const { rows, refs } = await queryRows(def, layout, params, { skip: 0, take: 10000 });
  const fields = layout.columns.map(k => layout.fields.find(f => f.key === k)).filter((f): f is LayoutField => !!f);
  const idLabel = layout.fields.find(f => f.type === "AUTO")?.label ?? def.idLabel;
  const lines = [[idLabel, ...fields.map(f => f.label)].map(csvCell).join(",")];
  for (const r of rows) lines.push([r.code, ...fields.map(f => displayValue(f, storedValue(f, r), refs))].map(csvCell).join(","));
  return "﻿" + lines.join("\r\n");
}
