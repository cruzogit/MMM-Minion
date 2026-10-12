import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readJson, withAuthRoute } from "@/lib/api";
import { hasPermission } from "@/lib/rbac/effective";
import { DEAL_NUMBER_PREFIX } from "@/lib/leads/constants";
import { todayDay } from "@/lib/leads/format";
import { genericModuleFrom } from "../../helpers";
import { audit, need, nextSeq, TX } from "@/lib/records/service";
import { approvers, projectTemplates } from "@/lib/records/lookups";
import { getLayout } from "@/lib/records/layout";
import { getField, normalizeCode, normalizeStr } from "@/lib/import/sheet";
import { describeRowFailure, IMPORT_BUDGET_MS, importBody } from "@/lib/import/body";
import {
  ALIASES, claim, codeOf, findExisting, isBlankRow, planRow, RowError,
  type ExistingRecord, type ImportRefs, type ImportSettings, type RefMap, type RowPlan,
} from "@/lib/records/import-rows";

// One request imports one batch of rows (the upload dialog reads the file and sends them 40 at a time), so it always finishes in time.
// What a cell means is decided in lib/records/import-rows.ts; this file loads the reference data and writes.
export const maxDuration = 60;

type Params = { params: Promise<{ module: string }> };

type Delegate = {
  findUnique(args: unknown): Promise<{ id: string } | null>;
  findFirst(args: unknown): Promise<{ id: string; dealId: string | null; customFields: Prisma.JsonValue } | null>;
  create(args: unknown): Promise<ExistingRecord>;
  update(args: unknown): Promise<{ id: string }>;
};

// The highest number taken from the file's own codes (PPR9000): a typo must not push every later record's number up
const MAX_FILE_SEQ = 1_000_000;
const APPROVED_STATUSES = new Set(["approved", "paid", "collected"]);

const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

// POST /api/records/[module]/import  { rows, duplicateStrategy, rowOffset }
export async function POST(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const def = await genericModuleFrom(params);
    if (def.id !== "prePayment" && def.id !== "paymentCollection") {
      return NextResponse.json({ error: "Import is supported for Pre-Payments and Payment Collections." }, { status: 400 });
    }
    need(ctx, def.id, "create");
    const { rows, duplicateStrategy: strategy, rowOffset } = await readJson(request, importBody);
    if (strategy === "update") need(ctx, def.id, "edit"); // changing existing records is editing, not creating

    const started = Date.now();
    const isPre = def.id === "prePayment";
    const canApprove = hasPermission(ctx.permissions, def.permission, "approve");

    // Reference data, loaded once per batch
    const [users, approverList, deals, materialVendors, serviceVendors, templates, layout, existingRecords] = await Promise.all([
      prisma.user.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, name: true, email: true, employee: { select: { employeeCode: true } } },
      }),
      approvers(def.id),
      prisma.deal.findMany({
        where: { deletedAt: null, dealNumber: { startsWith: DEAL_NUMBER_PREFIX } },
        select: { id: true, dealNumber: true, title: true, lead: { select: { customerName: true } } },
      }),
      prisma.materialVendor.findMany({ where: { deletedAt: null }, select: { id: true, code: true, companyName: true } }),
      prisma.serviceVendor.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, companyName: true } }),
      isPre ? projectTemplates() : Promise.resolve([]),
      getLayout(def.id),
      (prisma as unknown as Record<string, { findMany(args: unknown): Promise<ExistingRecord[]> }>)[def.model].findMany({
        where: { deletedAt: null },
        select: { id: true, seq: true, code: true },
      }),
    ]);

    const dealMap: RefMap = new Map();
    for (const d of deals) {
      claim(dealMap, d.id.toLowerCase(), d.id);
      if (d.dealNumber) {
        const digits = d.dealNumber.replace(/\D/g, "");
        for (const key of [d.dealNumber.toLowerCase().trim(), normalizeCode(d.dealNumber), digits, digits && `dl${digits}`]) claim(dealMap, key, d.id);
      }
      if (d.title) for (const key of [d.title.toLowerCase().trim(), normalizeStr(d.title)]) claim(dealMap, key, d.id);
      const customer = d.lead?.customerName;
      if (customer) for (const key of [customer.toLowerCase().trim(), normalizeStr(customer)]) claim(dealMap, key, d.id);
    }
    const vendorMap = (list: { id: string; code: string | null; names: (string | null)[] }[]): RefMap => {
      const map: RefMap = new Map();
      for (const v of list) {
        claim(map, v.id.toLowerCase(), v.id);
        if (v.code) for (const key of [v.code.toLowerCase().trim(), normalizeCode(v.code)]) claim(map, key, v.id);
        for (const name of v.names) if (name) for (const key of [name.toLowerCase().trim(), normalizeStr(name)]) claim(map, key, v.id);
      }
      return map;
    };
    const templateMap: RefMap = new Map();
    for (const t of templates) for (const key of [t.id.toLowerCase(), t.label.toLowerCase().trim(), normalizeStr(t.label)]) claim(templateMap, key, t.id);
    const records = new Map<string, ExistingRecord>();
    const remember = (r: ExistingRecord) => {
      for (const key of [r.id.toLowerCase(), r.code.toLowerCase().trim(), normalizeCode(r.code)]) records.set(key, r);
    };
    existingRecords.forEach(remember);

    const refs: ImportRefs = {
      users: users.map(u => ({ id: u.id, name: u.name, email: u.email, employeeCode: u.employee?.employeeCode ?? null })),
      approvers: approverList,
      deals: dealMap,
      materialVendors: vendorMap(materialVendors.map(v => ({ id: v.id, code: v.code, names: [v.companyName] }))),
      serviceVendors: vendorMap(serviceVendors.map(v => ({ id: v.id, code: v.code, names: [v.name, v.companyName] }))),
      templates: templateMap,
      records,
      fields: layout.fields,
    };
    const settings: ImportSettings = { isPre, idPrefix: def.idPrefix, canApprove, strategy };

    const optionIds = (key: string) => new Set((layout.fields.find(f => f.key === key)?.options ?? []).map(o => o.id));
    const choice = (key: string, preferred: string) => (optionIds(key).has(preferred) ? preferred : null);
    const model = (db: Prisma.TransactionClient) => (db as unknown as Record<string, Delegate>)[def.model];
    const today = new Date(`${todayDay()}T00:00:00Z`);

    const write = async (tx: Prisma.TransactionClient, plan: RowPlan): Promise<"created" | "updated" | "unchanged"> => {
      const c = plan.columns;
      const delegate = model(tx);
      const approvedAt = c.approvedById ? new Date() : undefined;

      if (plan.updating && plan.existing) {
        const before = await delegate.findFirst({ where: { id: plan.existing.id, deletedAt: null }, select: { id: true, dealId: true, customFields: true } });
        if (!before) throw new RowError("The record was deleted while the import was running.");
        const data: Record<string, unknown> = {
          ...(c.dealId !== undefined ? { dealId: c.dealId } : {}),
          ...(c.taskPersonId !== undefined ? { taskPersonId: c.taskPersonId } : {}),
          ...(c.paymentMode !== undefined ? { paymentMode: c.paymentMode } : {}),
          ...(c.paymentType !== undefined ? { paymentType: c.paymentType } : {}),
          ...(c.paymentStatus !== undefined ? { paymentStatus: c.paymentStatus } : {}),
          ...(c.materialVendorId !== undefined ? { materialVendorId: c.materialVendorId } : {}),
          ...(c.serviceVendorId !== undefined ? { serviceVendorId: c.serviceVendorId } : {}),
          ...(isPre && c.workTypeId !== undefined ? { workTypeId: c.workTypeId } : {}),
          ...(c.amount !== undefined ? { amount: new Prisma.Decimal(c.amount) } : {}),
          ...(c.date !== undefined ? { date: c.date } : {}),
          ...(c.utrDate !== undefined ? { utrDate: c.utrDate } : {}),
          ...(c.utrNumber !== undefined ? { utrNumber: c.utrNumber } : {}),
          ...(c.remarks !== undefined ? { remarks: c.remarks } : {}),
          ...(c.approvedById !== undefined ? { approvedById: c.approvedById, approvedAt } : {}),
        };
        const hasCustom = Object.keys(plan.custom).length > 0;
        if (Object.keys(data).length === 0 && !hasCustom) return "unchanged";
        if (hasCustom) {
          const old = before.customFields && typeof before.customFields === "object" && !Array.isArray(before.customFields) ? before.customFields : {};
          data.customFields = { ...old, ...plan.custom } as Prisma.InputJsonObject;
        }
        await delegate.update({ where: { id: before.id }, data: { ...data, updatedById: ctx.userId } });
        await audit(tx, ctx, def, before.id, "Updated", undefined, { imported: true, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, dayOf(v)])) }, c.dealId ?? before.dealId);
        return "updated";
      }

      // A new record. The number in the file's code (PPR12) is kept when it is free; otherwise the next number is taken.
      let seq: number | null = null;
      if (plan.fileSeq && plan.fileSeq <= MAX_FILE_SEQ && !plan.existing) {
        const taken = await delegate.findUnique({ where: { seq: plan.fileSeq }, select: { id: true } }); // a deleted record keeps its number too
        if (!taken) {
          seq = plan.fileSeq;
          await tx.$executeRaw`
            INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES (${def.counterKey}, ${seq}, now())
            ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", ${seq}), "updatedAt" = now()`;
        }
      }
      if (seq === null) seq = await nextSeq(tx, def.counterKey);
      const code = `${def.idPrefix}${seq}`;
      const status = c.paymentStatus ?? choice("paymentStatus", "pending_approval");
      const approvedById = c.approvedById ?? (canApprove && status && APPROVED_STATUSES.has(status) ? ctx.userId : null);
      const created = await delegate.create({
        data: {
          seq,
          code,
          dealId: c.dealId ?? null,
          taskPersonId: c.taskPersonId ?? ctx.userId, // the person who imports, like a record made in the form
          paymentMode: c.paymentMode ?? choice("paymentMode", "dbs_minion"),
          paymentType: c.paymentType ?? choice("paymentType", "other"),
          paymentStatus: status,
          materialVendorId: c.materialVendorId ?? null,
          serviceVendorId: c.serviceVendorId ?? null,
          ...(isPre ? { workTypeId: c.workTypeId ?? null } : {}),
          amount: c.amount !== undefined ? new Prisma.Decimal(c.amount) : null,
          date: c.date ?? today,
          utrDate: c.utrDate ?? null,
          utrNumber: c.utrNumber ?? null,
          remarks: c.remarks ?? "",
          approvedById,
          approvedAt: approvedById ? approvedAt ?? new Date() : null,
          customFields: Object.keys(plan.custom).length ? (plan.custom as Prisma.InputJsonObject) : Prisma.DbNull,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
        select: { id: true, seq: true, code: true },
      });
      await audit(tx, ctx, def, created.id, "Created", undefined, { code, imported: true, ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, dayOf(v)])) }, c.dealId ?? null);
      remember(created);
      return "created";
    };

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let processed = 0;
    const errors: { row: number; code: string; deal: string; reason: string }[] = [];
    const warnings: { row: number; code: string; reason: string }[] = [];

    // One row at a time, each in its own transaction: a row that fails leaves the others alone, and the counters never race
    for (let i = 0; i < rows.length; i++) {
      if (Date.now() - started > IMPORT_BUDGET_MS) break;
      processed = i + 1;
      const row = rows[i];
      const rowNo = rowOffset + i + 2; // the line in the file (line 1 holds the headings)
      if (isBlankRow(row)) continue;
      const code = codeOf(row);
      try {
        if (strategy === "skip" && findExisting(records, code)) {
          skipped++;
          continue;
        }
        const plan = planRow(row, settings, refs);
        const outcome = await prisma.$transaction(tx => write(tx, plan), TX);
        if (outcome === "created") imported++;
        else if (outcome === "updated") updated++;
        else skipped++;
        for (const reason of plan.warnings) warnings.push({ row: rowNo, code: code || "—", reason });
      } catch (err) {
        if (!(err instanceof RowError)) console.error("records import: row failed", def.id, rowNo, err);
        errors.push({
          row: rowNo,
          code: code || "—",
          deal: getField(row, ...ALIASES.deal) || "—",
          reason: err instanceof RowError ? err.message : describeRowFailure(err),
        });
      }
    }

    if (imported > 0 || updated > 0) {
      await prisma.cRMAuditLog.create({
        data: {
          entityType: def.entityType,
          entityId: "bulk-import",
          action: "Imported",
          performedById: ctx.employeeId,
          newValue: JSON.stringify({ rows: processed, imported, updated, skipped, errors: errors.length }),
        },
      });
    }

    return NextResponse.json({ success: true, processed, imported, updated, skipped, errors, warnings });
  });
}
