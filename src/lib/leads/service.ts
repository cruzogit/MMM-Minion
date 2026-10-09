import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/effective";
import { nextCustomerCode } from "@/lib/customers/numbering";
import { ServiceError } from "@/lib/users/service";
import { AUDIO_FILE_EXTENSIONS, isAllowedAudioType, sniffAudioType } from "./audio-types";
import { DEAL_CLOSING_MAX_YEARS, DEAL_NUMBER_PREFIX, FOLLOWUP_NEEDED_MESSAGE, IMAGE_FILE_EXTENSIONS, MIN_FOLLOWUPS_TO_CONVERT, isAttachmentAllowed, MAX_ATTACHMENTS_PER_LEAD, maxFileBytes, maxFileLabel, MAX_THUMBNAIL_BYTES, storageExtension, UNKNOWN_MIME_TYPE } from "./constants";
import { formatDate, formatDealStamp, formatDealValidity, formatTime, normalizePhone, todayDay, zonedDateTime } from "./format";
import { sniffImageType } from "./image-types";
import type { CloseLeadInput, ConvertLeadInput, FollowUpInput, LeadFieldInput, LeadInput, UploadFileInput } from "./schemas";
import { getLeadRow } from "./queries";
import { checkFieldAgainstLayout, checkLeadAgainstLayout, type CustomValues } from "./layout";
import { createReadUrls, createUploadUrl, readHead, removeObjects, statObject } from "./storage";

export const badRequest = (m: string) => new ServiceError(400, m);

// The Leads page and the Deals page share these functions. A "deal" action works on the lead behind a converted deal and needs
// the deals permissions; a "lead" action works on leads that were not converted and needs the leads permissions.
export type Scope = "lead" | "deal";
const moduleFor = (scope: Scope) => (scope === "deal" ? "deals" : "leads");
export const notFound = (scope: Scope = "lead") => new ServiceError(404, scope === "deal" ? "Deal not found" : "Lead not found");
// A converted lead lives on the Deals page: the Leads page can no longer change it (a stale page may still offer it)
const converted = () => new ServiceError(409, "This lead was converted to a deal, so it can no longer be changed.");

export type Db = Prisma.TransactionClient | typeof prisma;

export function need(actor: AuthContext, action: "view" | "create" | "edit" | "delete", scope: Scope = "lead") {
  if (!hasPermission(actor.permissions, moduleFor(scope), action)) {
    throw new ServiceError(403, `You do not have permission to ${action} ${moduleFor(scope)}.`);
  }
}

// Which leads an action may touch: the Leads page the ones that were not converted, the Deals page the converted ones
function inScope(lead: { convertedAt: Date | null }, scope: Scope) {
  if (scope === "lead" && lead.convertedAt) throw converted();
  if (scope === "deal" && !lead.convertedAt) throw notFound("deal");
}

// The live deal made from a converted lead (one lead has one deal made by Convert)
export function dealOf(db: Db, leadId: string) {
  return db.deal.findFirst({
    where: { leadId, dealNumber: { startsWith: DEAL_NUMBER_PREFIX }, deletedAt: null },
    select: { id: true, dealNumber: true, title: true, value: true, expectedCloseDate: true, dealStatusId: true, createdAt: true },
  });
}

// ---------------------------------------------------------------------------
// Lead ID: one atomic counter row. The row lock is held until the surrounding
// transaction commits, so two users can never receive the same number, and
// numbers are never reused after a delete.
// ---------------------------------------------------------------------------
export async function nextLeadSeq(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES ('lead', 1, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  return Number(rows[0].value);
}

export const leadCodeFor = (seq: number) => `ML${seq}`;

// ---------------------------------------------------------------------------
// Reference validation: every id must exist, be the right kind of option, and a Subcategory must belong to the chosen Main Category.
// Nothing from the browser is trusted.
// ---------------------------------------------------------------------------
export async function resolveReferences(input: LeadInput) {
  const optionIds = [input.productOrServiceId, input.requirementId, input.modeOfCustomerId, input.sourceId, input.mainCategoryId, input.subcategoryId, input.leadStatusId, input.leadTypeId].filter((x): x is string => !!x);
  const options = await prisma.leadOption.findMany({
    where: { id: { in: optionIds } },
    select: { id: true, type: true, parentId: true, label: true },
  });
  const byId = new Map(options.map(o => [o.id, o]));
  const expect = (id: string | null | undefined, type: string, label: string) => {
    if (!id) return null;
    const o = byId.get(id);
    if (!o || o.type !== type) throw badRequest(`${label} is not valid`);
    return o;
  };
  expect(input.productOrServiceId, "PRODUCT_OR_SERVICE", "Product or Service");
  const requirement = expect(input.requirementId, "REQUIREMENT", "Requirements");
  expect(input.modeOfCustomerId, "MODE_OF_CUSTOMER", "Mode of Customer");
  const source = expect(input.sourceId, "SOURCE", "Source");
  expect(input.mainCategoryId, "MAIN_CATEGORY", "Main Category");
  const subcategory = expect(input.subcategoryId, "SUBCATEGORY", "Subcategory");
  expect(input.leadStatusId, "LEAD_STATUS", "Lead Status");
  expect(input.leadTypeId, "LEAD_TYPE", "Type Of Lead");
  if (subcategory && !input.mainCategoryId) throw badRequest("Choose a Main Category for the Subcategory");
  if (subcategory && subcategory.parentId !== input.mainCategoryId) throw badRequest("Subcategory does not belong to the selected Main Category");

  const employeeIds = [input.taskAssignedPersonId, input.leadPersonId].filter((x): x is string => !!x);
  const employees = await prisma.employee.findMany({
    where: { id: { in: employeeIds }, user: { deletedAt: null, status: "ACTIVE" } },
    select: { id: true },
  });
  const known = new Set(employees.map(e => e.id));
  if (input.taskAssignedPersonId && !known.has(input.taskAssignedPersonId)) throw badRequest("Task Assigned Person is not valid");
  if (input.leadPersonId && !known.has(input.leadPersonId)) throw badRequest("Lead Person is not valid");

  return { requirementLabel: requirement?.label ?? null, sourceLabel: source?.label ?? null };
}

export async function findOrCreateCustomer(db: Db, name: string, phone: string) {
  const exact = await db.customer.findFirst({ where: { phone }, select: { id: true } });
  if (exact) return exact.id;
  // Older customers were typed with spaces/dashes: compare digits only
  const loose = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Customer" WHERE regexp_replace("phone", '[^0-9+]', '', 'g') = ${phone} LIMIT 1`;
  if (loose[0]) return loose[0].id;
  return (await db.customer.create({ data: { name, phone, customerType: "Individual", customerCode: await nextCustomerCode(db) }, select: { id: true } })).id;
}

export function leadData(input: LeadInput, refs: Awaited<ReturnType<typeof resolveReferences>>, actor: AuthContext, phone: string, custom: CustomValues, scope: Scope = "lead") {
  return {
    customerName: input.customerName,
    contactNumber: phone,
    salesExecutiveId: input.taskAssignedPersonId,
    leadPersonId: input.leadPersonId ?? actor.employeeId ?? null,
    productOrServiceId: input.productOrServiceId,
    requirementId: input.requirementId,
    exactRequirement: input.exactRequirement,
    modeOfCustomerId: input.modeOfCustomerId,
    sourceId: input.sourceId,
    location: input.location,
    exactLocation: input.exactLocation,
    locationLink: input.locationLink,
    mainCategoryId: input.mainCategoryId,
    subcategoryId: input.subcategoryId,
    leadTypeId: input.leadTypeId,
    conventionalRate: input.conventionalRate,
    notes: input.notes,
    dailyTask: input.dailyTask,
    customFields: Object.keys(custom).length ? (custom as Prisma.InputJsonObject) : Prisma.DbNull,
    // Mirror into the older CRM columns so /crm keeps showing these leads sensibly
    source: refs.sourceLabel,
    requirement: input.exactRequirement ?? refs.requirementLabel,
    siteLocation: input.location,
    // A deal has its own Deal Status and its Amount is the Deal Value, so editing a deal leaves the lead's status and amount alone
    ...(scope === "deal" ? {} : { leadStatusId: input.leadStatusId, amount: input.amount, expectedValue: input.amount }),
  };
}

export async function audit(db: Db, actor: AuthContext, leadId: string, action: string, oldValue?: unknown, newValue?: unknown, dealId?: string) {
  await db.cRMAuditLog.create({
    data: {
      entityType: dealId ? "Deal" : "Lead",
      entityId: dealId ?? leadId,
      leadId,
      ...(dealId ? { dealId } : {}),
      action,
      performedById: actor.employeeId,
      oldValue: oldValue === undefined ? null : JSON.stringify(oldValue),
      newValue: newValue === undefined ? null : JSON.stringify(newValue),
    },
  });
}

export const TX = { maxWait: 10_000, timeout: 20_000 };

// What an edit changes, for the audit trail: only the fields whose value is different now
export function changesOf(before: object, data: object) {
  const record = before as Record<string, unknown>;
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const was = record[key];
    const text = (x: unknown) => (x === null || x === undefined || x === Prisma.DbNull ? null : typeof x === "object" && !(x instanceof Date) && !("toFixed" in (x as object)) ? JSON.stringify(x) : String(x));
    if (text(was) !== text(value)) { from[key] = was ?? null; to[key] = value ?? null; }
  }
  return { from, to };
}

async function insertLead(actor: AuthContext, input: LeadInput, action: string) {
  const custom = await checkLeadAgainstLayout(input);
  const refs = await resolveReferences(input);
  const phone = normalizePhone(input.contactNumber)!;
  return prisma.$transaction(async tx => {
    const customerId = await findOrCreateCustomer(tx, input.customerName, phone);
    // Take the number last, so the counter row is locked for as short a time as possible
    const seq = await nextLeadSeq(tx);
    const code = leadCodeFor(seq);
    const lead = await tx.lead.create({
      data: {
        ...leadData(input, refs, actor, phone, custom),
        customerId,
        leadSeq: seq,
        leadCode: code,
        leadNumber: code,
        status: "New",
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      select: { id: true, leadCode: true, createdAt: true },
    });
    await audit(tx, actor, lead.id, action, undefined, { leadCode: code, customerName: input.customerName, contactNumber: phone });
    return lead;
  }, TX);
}

export async function createLead(actor: AuthContext, input: LeadInput) {
  need(actor, "create");
  return insertLead(actor, input, "Created");
}

export async function updateLead(actor: AuthContext, id: string, input: LeadInput) {
  need(actor, "edit");
  const before = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound();
  if (before.convertedAt) throw converted();
  const custom = await checkLeadAgainstLayout(input);
  const refs = await resolveReferences(input);
  const phone = normalizePhone(input.contactNumber)!;
  const data = leadData(input, refs, actor, phone, custom);

  await prisma.$transaction(async tx => {
    const customerId = phone !== before.contactNumber ? await findOrCreateCustomer(tx, input.customerName, phone) : undefined;
    const changes = changesOf(before, data);
    await tx.lead.update({ where: { id }, data: { ...data, ...(customerId ? { customerId } : {}), updatedById: actor.userId } });
    await audit(tx, actor, id, "Updated", changes.from, changes.to);
  }, TX);
}

export async function updateNotes(actor: AuthContext, id: string, notes: string | null, scope: Scope = "lead") {
  need(actor, "edit", scope);
  const before = await prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { notes: true, convertedAt: true } });
  if (!before) throw notFound(scope);
  inScope(before, scope);
  await prisma.$transaction(async tx => {
    await tx.lead.update({ where: { id }, data: { notes, updatedById: actor.userId } });
    await audit(tx, actor, id, "Notes Updated", { notes: before.notes }, { notes }, scope === "deal" ? (await dealOf(tx, id))?.id : undefined);
  }, TX);
}

// Inline edit of one field from the Leads table (Amount, Lead Status, Location, Exact Location). Same permission,
// validation and audit trail as editing the lead in the form, and the older CRM mirror columns are kept in step.
export async function updateLeadField(actor: AuthContext, id: string, input: LeadFieldInput, scope: Scope = "lead") {
  need(actor, "edit", scope);
  const before = await prisma.lead.findFirst({
    where: { id, deletedAt: null },
    select: { amount: true, expectedValue: true, leadStatusId: true, location: true, siteLocation: true, exactLocation: true, convertedAt: true },
  });
  if (!before) throw notFound(scope);
  inScope(before, scope);
  // On the Deals page the Amount is the Deal Value and the status is the Deal Status: both belong to the deal itself
  const deal = scope === "deal" ? await dealOf(prisma, id) : null;
  if (scope === "deal" && !deal) throw notFound("deal");
  if (!(deal && (input.field === "amount" || input.field === "leadStatusId"))) await checkFieldAgainstLayout(input.field, input.value);

  let from: string | number | null;
  let to: string | number | null;
  let name: string = input.field; // how the change is named in the audit trail
  let data: Prisma.LeadUncheckedUpdateInput = {};
  let dealData: Prisma.DealUncheckedUpdateInput | null = null;
  switch (input.field) {
    case "amount": {
      const value = input.value === null ? null : Math.round(input.value * 100) / 100;
      if (deal) {
        if (value === null || value <= 0) throw badRequest("Deal Value must be more than 0");
        name = "dealValue";
        from = Number(deal.value);
        to = value;
        dealData = { value };
      } else {
        from = before.amount !== null ? Number(before.amount) : before.expectedValue !== null ? Number(before.expectedValue) : null;
        to = value;
        data = { amount: value, expectedValue: value };
      }
      break;
    }
    case "leadStatusId": {
      if (deal) {
        if (input.value && !(await prisma.leadOption.findFirst({ where: { id: input.value, type: "DEAL_STATUS" }, select: { id: true } }))) throw badRequest("Deal Status is not valid");
        name = "dealStatusId";
        from = deal.dealStatusId;
        to = input.value;
        dealData = { dealStatusId: input.value };
      } else {
        if (input.value && !(await prisma.leadOption.findFirst({ where: { id: input.value, type: "LEAD_STATUS" }, select: { id: true } }))) throw badRequest("Lead Status is not valid");
        from = before.leadStatusId;
        to = input.value;
        data = { leadStatusId: input.value };
      }
      break;
    }
    case "location":
      from = before.location ?? before.siteLocation;
      to = input.value;
      data = { location: input.value, siteLocation: input.value };
      break;
    case "exactLocation":
      from = before.exactLocation;
      to = input.value;
      data = { exactLocation: input.value };
      break;
  }
  if (from === to) return; // nothing changed: no write, no audit entry
  await prisma.$transaction(async tx => {
    await tx.lead.update({ where: { id }, data: { ...data, updatedById: actor.userId } });
    if (deal && dealData) await tx.deal.update({ where: { id: deal.id }, data: dealData });
    await audit(tx, actor, id, "Updated", { [name]: from }, { [name]: to }, deal?.id);
  }, TX);
}

// Soft delete: the row, its number and its files are kept
export async function deleteLead(actor: AuthContext, id: string) {
  need(actor, "delete");
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null }, select: { leadCode: true, customerName: true, convertedAt: true } });
  if (!lead) throw notFound();
  if (lead.convertedAt) throw converted();
  await prisma.$transaction(async tx => {
    await tx.lead.update({ where: { id }, data: { deletedAt: new Date(), updatedById: actor.userId } });
    await audit(tx, actor, id, "Deleted", { leadCode: lead.leadCode, customerName: lead.customerName });
  }, TX);
}

export async function duplicateLead(actor: AuthContext, id: string) {
  need(actor, "create");
  const src = await prisma.lead.findFirst({ where: { id, deletedAt: null } });
  if (!src) throw notFound();
  if (src.convertedAt) throw converted();
  if (!src.customerName || !src.contactNumber) throw badRequest("This lead is missing required details. Edit it first, then duplicate.");
  const input: LeadInput = {
    customerName: src.customerName,
    contactNumber: src.contactNumber,
    taskAssignedPersonId: src.salesExecutiveId,
    productOrServiceId: src.productOrServiceId,
    requirementId: src.requirementId,
    exactRequirement: src.exactRequirement,
    modeOfCustomerId: src.modeOfCustomerId,
    sourceId: src.sourceId,
    location: src.location,
    exactLocation: src.exactLocation,
    locationLink: src.locationLink,
    mainCategoryId: src.mainCategoryId,
    subcategoryId: src.subcategoryId,
    leadPersonId: src.leadPersonId,
    leadStatusId: src.leadStatusId,
    amount: src.amount !== null ? Number(src.amount) : null,
    conventionalRate: src.conventionalRate !== null ? Number(src.conventionalRate) : null,
    notes: src.notes,
    leadTypeId: src.leadTypeId,
    dailyTask: src.dailyTask,
    customFields: (src.customFields ?? {}) as Record<string, string | number | boolean | null>,
  };
  return insertLead(actor, input, "Duplicated");
}

// What the screens need to show a stored file. Images also have a small thumbnail for lists and galleries; files
// uploaded before image optimization have none, and the screens fall back to the file itself.
const FILE_SELECT = { id: true, fileName: true, mimeType: true, size: true, storagePath: true, thumbnailPath: true, width: true, height: true } as const;
type StoredFile = { id: string; fileName: string; mimeType: string; size: number; storagePath: string; thumbnailPath: string | null; width: number | null; height: number | null };
const rowPaths = (f: { storagePath: string; thumbnailPath: string | null }) => (f.thumbnailPath ? [f.storagePath, f.thumbnailPath] : [f.storagePath]);
function fileDto(f: StoredFile, urls: Map<string, string>) {
  return {
    id: f.id, fileName: f.fileName, mimeType: f.mimeType, size: f.size,
    url: urls.get(f.storagePath) ?? null,
    thumbUrl: f.thumbnailPath ? urls.get(f.thumbnailPath) ?? null : null,
    width: f.width, height: f.height,
  };
}

export async function getLeadDetail(actor: AuthContext, id: string) {
  need(actor, "view");
  return leadDetail(id);
}

// Everything the View dialog shows for a lead. The Deals page opens it for a deal's original lead too, after its own permission check.
export async function leadDetail(id: string) {
  const row = await getLeadRow(id);
  if (!row) throw notFound();
  const files = await prisma.leadAttachment.findMany({
    where: { leadId: id, followUpId: null, closureId: null, status: "READY", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: FILE_SELECT,
  });
  const followUps = await prisma.leadFollowUp.findMany({
    where: { leadId: id, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: 50,
    select: {
      id: true, notes: true, nextAt: true, completedAt: true,
      attachments: { where: { status: "READY", deletedAt: null }, orderBy: { createdAt: "asc" }, select: FILE_SELECT },
    },
  });
  // Why the lead was closed, only while it is closed (a reopened lead keeps its old closures as history)
  const closure = row.isClosed
    ? await prisma.leadClosure.findFirst({
        where: { leadId: id, closedAt: { not: null } },
        orderBy: { closedAt: "desc" },
        select: { reason: true, closedAt: true, closedById: true, attachments: { where: { status: "READY", deletedAt: null }, orderBy: { createdAt: "asc" }, select: FILE_SELECT } },
      })
    : null;
  // The deal this lead became, once it was converted
  const deal = row.isConverted
    ? await prisma.deal.findFirst({
        where: { leadId: id, dealNumber: { startsWith: DEAL_NUMBER_PREFIX }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, dealNumber: true, title: true, value: true, expectedCloseDate: true, createdAt: true, dealStatus: { select: { label: true } } },
      })
    : null;
  const closedBy = closure?.closedById ? (await prisma.user.findUnique({ where: { id: closure.closedById }, select: { name: true } }))?.name ?? null : null;
  const urls = await createReadUrls([...files, ...followUps.flatMap(f => f.attachments), ...(closure?.attachments ?? [])].flatMap(rowPaths));
  return {
    lead: row,
    deal: deal
      ? { id: deal.id, number: deal.dealNumber ?? "—", name: deal.title, value: Number(deal.value), validity: deal.expectedCloseDate ? formatDealValidity(deal.expectedCloseDate) : null, createdOn: formatDealStamp(deal.createdAt), status: deal.dealStatus?.label ?? null }
      : null,
    closure: closure
      ? { reason: closure.reason, closedOn: closure.closedAt ? `${formatDate(closure.closedAt)} ${formatTime(closure.closedAt)}` : "", closedBy, files: closure.attachments.map(a => fileDto(a, urls)) }
      : null,
    attachments: files.map(f => fileDto(f, urls)),
    followUps: followUps.map(f => ({
      id: f.id,
      notes: f.notes,
      doneOn: f.completedAt ? `${formatDate(f.completedAt)} ${formatTime(f.completedAt)}` : "",
      next: f.nextAt ? `${formatDate(f.nextAt)} ${formatTime(f.nextAt)}` : null,
      files: f.attachments.map(a => fileDto(a, urls)),
    })),
  };
}

// Follow-up history for the popup opened from the Follow-up column's number: oldest first (1st, 2nd, ...),
// each with its proof files as short-lived signed links
export async function listLeadFollowUps(actor: AuthContext, leadId: string, scope: Scope = "lead") {
  need(actor, "view", scope);
  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { id: true, convertedAt: true } });
  if (!lead) throw notFound(scope);
  if (scope === "deal") inScope(lead, scope);
  const rows = await prisma.leadFollowUp.findMany({
    where: { leadId, completedAt: { not: null } },
    orderBy: { completedAt: "asc" },
    take: 200,
    select: {
      id: true, notes: true, nextAt: true, completedAt: true,
      attachments: { where: { status: "READY", deletedAt: null }, orderBy: { createdAt: "asc" }, select: FILE_SELECT },
    },
  });
  const urls = await createReadUrls(rows.flatMap(f => f.attachments).flatMap(rowPaths));
  const when = (d: Date) => ({ date: formatDate(d), time: formatTime(d) });
  return {
    followUps: rows.map((f, i) => ({
      id: f.id,
      number: i + 1,
      notes: f.notes,
      doneOn: when(f.completedAt!),
      next: f.nextAt ? when(f.nextAt) : null,
      files: f.attachments.map(a => fileDto(a, urls)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Attachments: browser -> signed URL -> Supabase Storage directly (no file bytes pass
// through our server). The server then checks what Storage actually holds.
// ---------------------------------------------------------------------------
async function assertCanAttach(actor: AuthContext, leadId: string, scope: Scope = "lead") {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { createdById: true, convertedAt: true } });
  if (!lead) throw notFound(scope);
  inScope(lead, scope);
  const canEdit = hasPermission(actor.permissions, moduleFor(scope), "edit");
  const creatorOfThis = hasPermission(actor.permissions, moduleFor(scope), "create") && lead.createdById === actor.userId;
  if (!canEdit && !creatorOfThis) throw new ServiceError(403, `You do not have permission to attach files to this ${scope}.`);
}

// Where a file is stored. Paths are never built from the user's file name. Images go to optimized/ and thumbnails/
// folders; documents keep the original layout (leads/<id>/<uuid>.<ext>).
function planStorage(prefix: string, f: UploadFileInput) {
  const id = randomUUID();
  if (f.image) {
    return {
      storagePath: `${prefix}/optimized/${id}.${IMAGE_FILE_EXTENSIONS[f.type]}`,
      thumbnailPath: `${prefix}/thumbnails/${id}.${IMAGE_FILE_EXTENSIONS[f.image.thumbnail.type]}`,
    };
  }
  if (isAllowedAudioType(f.type)) return { storagePath: `${prefix}/audio/${id}.${AUDIO_FILE_EXTENSIONS[f.type]}`, thumbnailPath: null as string | null };
  return { storagePath: `${prefix}/${id}.${storageExtension(f.name)}`, thumbnailPath: null as string | null };
}

// The LeadAttachment columns for a file that is about to be uploaded
function attachmentData(f: UploadFileInput, plan: { storagePath: string; thumbnailPath: string | null }) {
  return {
    storagePath: plan.storagePath,
    thumbnailPath: plan.thumbnailPath,
    fileName: f.name.slice(0, 255),
    mimeType: f.type || UNKNOWN_MIME_TYPE,
    size: f.size,
    width: f.image?.width ?? null,
    height: f.image?.height ?? null,
    originalSize: f.image?.originalSize ?? null,
    contentHash: f.image?.contentHash ?? null,
  };
}

// The same photo twice (same SHA-256) is skipped. `known` holds the hashes already present in this scope and grows as files are kept.
function dropDuplicates(files: UploadFileInput[], known: Set<string>) {
  const keep: { index: number; file: UploadFileInput }[] = [];
  const skipped: { index: number; name: string }[] = [];
  files.forEach((file, index) => {
    const hash = file.image?.contentHash;
    if (hash && known.has(hash)) { skipped.push({ index, name: file.name }); return; }
    if (hash) known.add(hash);
    keep.push({ index, file });
  });
  return { keep, skipped };
}

// Checks what Storage really holds, not what the browser said. For an image that means the bytes are the declared
// JPEG/PNG/WebP and the thumbnail exists and is small. `cleanup`: the stored object(s) should be removed.
type Verdict = { ok: true; size: number; mimeType: string } | { ok: false; reason: string; cleanup: boolean };
async function verifyUpload(row: { storagePath: string; thumbnailPath: string | null; fileName: string; mimeType: string }): Promise<Verdict> {
  const stat = await statObject(row.storagePath);
  if (!stat) return { ok: false, reason: "Upload not found", cleanup: false };
  if (!isAttachmentAllowed(row.fileName)) return { ok: false, reason: "File type not allowed", cleanup: true };
  if (stat.size <= 0 || stat.size > maxFileBytes(row.mimeType)) return { ok: false, reason: `File is empty or larger than ${maxFileLabel(row.mimeType)}`, cleanup: true };
  if (row.mimeType.startsWith("audio/")) {
    if (sniffAudioType(await readHead(row.storagePath), true) !== row.mimeType) return { ok: false, reason: "File is not a valid audio file", cleanup: true };
    return { ok: true, size: stat.size, mimeType: row.mimeType };
  }
  if (!row.thumbnailPath) return { ok: true, size: stat.size, mimeType: stat.mimeType || row.mimeType };

  if (sniffImageType(await readHead(row.storagePath)) !== row.mimeType) return { ok: false, reason: "File is not a valid image", cleanup: true };
  const thumb = await statObject(row.thumbnailPath);
  if (!thumb || thumb.size <= 0 || thumb.size > MAX_THUMBNAIL_BYTES) return { ok: false, reason: "Image thumbnail is missing or too large", cleanup: true };
  const thumbType = sniffImageType(await readHead(row.thumbnailPath));
  if (thumbType !== "image/webp" && thumbType !== "image/jpeg") return { ok: false, reason: "Image thumbnail is not valid", cleanup: true };
  return { ok: true, size: stat.size, mimeType: row.mimeType };
}

export async function signAttachmentUploads(actor: AuthContext, leadId: string, files: UploadFileInput[], scope: Scope = "lead") {
  await assertCanAttach(actor, leadId, scope);
  // The same photo among this lead's own files is a duplicate; the same photo on another lead, or as follow-up proof, is fine
  const hashes = files.flatMap(f => (f.image?.contentHash ? [f.image.contentHash] : []));
  const attached = hashes.length
    ? await prisma.leadAttachment.findMany({ where: { leadId, followUpId: null, closureId: null, deletedAt: null, status: "READY", contentHash: { in: hashes } }, select: { contentHash: true } })
    : [];
  const { keep, skipped } = dropDuplicates(files, new Set(attached.flatMap(a => (a.contentHash ? [a.contentHash] : []))));

  const existing = await prisma.leadAttachment.count({ where: { leadId, followUpId: null, closureId: null, deletedAt: null, status: { in: ["READY", "PENDING"] } } });
  if (existing + keep.length > MAX_ATTACHMENTS_PER_LEAD) {
    throw badRequest(`A lead can have at most ${MAX_ATTACHMENTS_PER_LEAD} files.`);
  }
  const uploads: { index: number; id: string; name: string; uploadUrl: string; thumbnailUploadUrl: string | null }[] = [];
  for (const { index, file } of keep) {
    if (!isAttachmentAllowed(file.name) || file.size > maxFileBytes(file.type)) throw badRequest(`${file.name}: file type or size is not allowed`);
    const plan = planStorage(`leads/${leadId}`, file);
    const uploadUrl = await createUploadUrl(plan.storagePath);
    const thumbnailUploadUrl = plan.thumbnailPath ? await createUploadUrl(plan.thumbnailPath) : null;
    const row = await prisma.leadAttachment.create({
      data: { leadId, ...attachmentData(file, plan), status: "PENDING", uploadedById: actor.userId },
      select: { id: true },
    });
    uploads.push({ index, id: row.id, name: file.name, uploadUrl, thumbnailUploadUrl });
  }
  return { uploads, skipped };
}

export async function completeAttachmentUploads(actor: AuthContext, leadId: string, ids: string[], scope: Scope = "lead") {
  await assertCanAttach(actor, leadId, scope);
  const rows = await prisma.leadAttachment.findMany({ where: { id: { in: ids }, leadId, status: "PENDING", deletedAt: null } });
  const result: { id: string; ok: boolean; reason?: string }[] = [];
  for (const row of rows) {
    const verdict = await verifyUpload(row);
    if (!verdict.ok) {
      if (verdict.cleanup) {
        await removeObjects(rowPaths(row));
        await prisma.leadAttachment.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      }
      result.push({ id: row.id, ok: false, reason: verdict.reason });
      continue;
    }
    await prisma.leadAttachment.update({ where: { id: row.id }, data: { status: "READY", size: verdict.size, mimeType: verdict.mimeType } });
    result.push({ id: row.id, ok: true });
  }
  return result;
}

export async function removeAttachment(actor: AuthContext, leadId: string, attachmentId: string, scope: Scope = "lead") {
  need(actor, "edit", scope);
  const owner = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { convertedAt: true } });
  if (!owner) throw notFound(scope);
  inScope(owner, scope);
  const row = await prisma.leadAttachment.findFirst({ where: { id: attachmentId, leadId, deletedAt: null } });
  if (!row) throw new ServiceError(404, "File not found");
  await prisma.leadAttachment.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  await removeObjects(rowPaths(row));
}

// ---------------------------------------------------------------------------
// Follow-up proof (Leads → Follow-up column). Same direct-to-Storage upload as attachments:
// step 1 records the follow-up and hands out upload URLs, step 2 verifies the files and
// only then counts the follow-up and moves the lead's Last / Next dates.
// ---------------------------------------------------------------------------
export async function startFollowUp(actor: AuthContext, leadId: string, input: FollowUpInput, scope: Scope = "lead") {
  await assertCanAttach(actor, leadId, scope);
  const nextAt = input.nextDate ? zonedDateTime(input.nextDate, input.nextTime || "09:00") : null;
  if (nextAt && nextAt.getTime() < Date.now() - 24 * 60 * 60 * 1000) throw badRequest("The next follow-up cannot be in the past.");

  // The same photo twice in one follow-up is skipped; the same photo in another follow-up (or lead) is fine
  const { keep, skipped } = dropDuplicates(input.files, new Set());

  // Ask Storage for the upload links first, so nothing is saved if storage is not set up
  const planned: { index: number; file: UploadFileInput; storagePath: string; thumbnailPath: string | null; uploadUrl: string; thumbnailUploadUrl: string | null }[] = [];
  for (const { index, file } of keep) {
    if (!isAttachmentAllowed(file.name) || file.size > maxFileBytes(file.type)) throw badRequest(`${file.name}: file type or size is not allowed`);
    const plan = planStorage(`leads/${leadId}/followups`, file);
    planned.push({
      index, file, ...plan,
      uploadUrl: await createUploadUrl(plan.storagePath),
      thumbnailUploadUrl: plan.thumbnailPath ? await createUploadUrl(plan.thumbnailPath) : null,
    });
  }

  const followUp = await prisma.leadFollowUp.create({
    data: {
      leadId,
      notes: input.notes,
      nextAt,
      createdById: actor.userId,
      attachments: {
        create: planned.map(p => ({ leadId, ...attachmentData(p.file, p), status: "PENDING", uploadedById: actor.userId })),
      },
    },
    select: { id: true, attachments: { select: { id: true, storagePath: true } } },
  });
  const byPath = new Map(planned.map(p => [p.storagePath, p]));
  return {
    followUpId: followUp.id,
    uploads: followUp.attachments.map(a => {
      const p = byPath.get(a.storagePath)!;
      return { index: p.index, id: a.id, name: p.file.name, uploadUrl: p.uploadUrl, thumbnailUploadUrl: p.thumbnailUploadUrl };
    }),
    skipped,
  };
}

export async function finishFollowUp(actor: AuthContext, leadId: string, followUpId: string, scope: Scope = "lead") {
  await assertCanAttach(actor, leadId, scope);
  const followUp = await prisma.leadFollowUp.findFirst({
    where: { id: followUpId, leadId, completedAt: null },
    select: { id: true, nextAt: true, notes: true, attachments: { where: { status: "PENDING", deletedAt: null }, select: { id: true, storagePath: true, thumbnailPath: true, fileName: true, mimeType: true } } },
  });
  if (!followUp) throw new ServiceError(404, "Follow-up not found, or it was already saved.");
  if (!followUp.attachments.length) throw badRequest("No files were attached to this follow-up.");

  const problems: string[] = [];
  const good: string[] = [];
  for (const a of followUp.attachments) {
    const verdict = await verifyUpload(a);
    if (!verdict.ok) {
      if (verdict.cleanup) {
        await removeObjects(rowPaths(a));
        await prisma.leadAttachment.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
      }
      problems.push(verdict.reason === "Upload not found" ? "A file did not finish uploading" : verdict.reason);
      continue;
    }
    await prisma.leadAttachment.update({ where: { id: a.id }, data: { status: "READY", size: verdict.size, mimeType: verdict.mimeType } });
    good.push(a.id);
  }
  if (problems.length || !good.length) throw badRequest(`${problems[0] ?? "The files could not be verified"}. Nothing was saved; please try again.`);

  const now = new Date();

  // Automatic Task Creation from Follow-up
  if (followUp.nextAt) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, salesExecutiveId: true, leadPersonId: true, deals: { select: { id: true, salesExecutiveId: true }, take: 1, orderBy: { createdAt: 'desc' } } }
    });
    
    if (lead) {
      let taskPersonId = lead.salesExecutiveId || lead.leadPersonId;
      let finalDealId = null;
      if (scope === "deal" && lead.deals.length > 0) {
        finalDealId = lead.deals[0].id;
        taskPersonId = lead.deals[0].salesExecutiveId || taskPersonId;
      }
      
      if (taskPersonId) {
        const dueAt = new Date(followUp.nextAt);
        dueAt.setHours(18, 0, 0, 0);

        const taskType = scope === "deal" ? "deal" : "lead";
        
        const existingTask = await prisma.task.findFirst({
          where: { 
            leadId: scope === "lead" ? leadId : null,
            dealId: scope === "deal" ? finalDealId : null,
            taskType: taskType,
            status: { notIn: ["Completed", "Verified", "Closed"] }
          },
          orderBy: { createdAt: 'desc' }
        });

        if (existingTask) {
          await prisma.task.update({
            where: { id: existingTask.id },
            data: {
              assignedAt: followUp.nextAt,
              startDate: followUp.nextAt,
              dueDate: dueAt,
              title: "Follow-up",
              notes: followUp.notes,
            }
          });
        } else {
          await prisma.task.create({
            data: {
              title: "Follow-up Task",
              description: "Automatically created from Follow-up",
              notes: followUp.notes,
              taskType: taskType,
              leadId: scope === "lead" ? leadId : null,
              dealId: scope === "deal" ? finalDealId : null,
              priority: "Medium",
              status: "Upcoming",
              assignedAt: followUp.nextAt,
              startDate: followUp.nextAt,
              dueDate: dueAt,
              assigneeId: taskPersonId,
              assignedByEmployeeId: taskPersonId
            }
          });
        }
      }
    }
  }

  await prisma.$transaction([
    prisma.leadFollowUp.update({ where: { id: followUp.id }, data: { completedAt: now } }),
    prisma.lead.update({ where: { id: leadId }, data: { lastContactedAt: now, nextActionDate: followUp.nextAt } }),
  ]);
  const count = await prisma.leadFollowUp.count({ where: { leadId, completedAt: { not: null } } });
  return {
    count,
    last: { date: formatDate(now), time: formatTime(now) },
    next: followUp.nextAt ? { date: formatDate(followUp.nextAt), time: formatTime(followUp.nextAt) } : null,
  };
}

// ---------------------------------------------------------------------------
// Close Lead (Leads → Actions). Same two steps as follow-up proof: step 1 records why the lead is being closed and
// hands out upload URLs for the optional files; step 2 checks the files and only then closes the lead (Lead.closedAt,
// which the Status column shows as "Closed") and writes the audit entry. The Lead Status is not touched. If anything
// goes wrong nothing is closed and the half-saved files are removed. Reopen Lead clears closedAt again; every closing
// stays in LeadClosure as history.
// ---------------------------------------------------------------------------

// Throws away an attempt that cannot finish: its files in Storage, its file rows and the unfinished closing
async function abandonClosure(closure: { id: string; attachments: { storagePath: string; thumbnailPath: string | null }[] }) {
  await removeObjects(closure.attachments.flatMap(rowPaths));
  await prisma.leadAttachment.updateMany({ where: { closureId: closure.id }, data: { deletedAt: new Date() } });
  await prisma.leadClosure.delete({ where: { id: closure.id } }).catch(() => undefined);
}

export async function startLeadClosure(actor: AuthContext, leadId: string, input: CloseLeadInput, scope: Scope = "lead") {
  need(actor, "edit", scope);
  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { closedAt: true, convertedAt: true } });
  if (!lead) throw notFound(scope);
  inScope(lead, scope);
  if (lead.closedAt) throw new ServiceError(409, `This ${scope} is already closed.`);

  // The same photo twice in one closing is skipped
  const { keep, skipped } = dropDuplicates(input.files, new Set());

  // Ask Storage for the upload links first, so nothing is saved if storage is not set up
  const planned: { index: number; file: UploadFileInput; storagePath: string; thumbnailPath: string | null; uploadUrl: string; thumbnailUploadUrl: string | null }[] = [];
  for (const { index, file } of keep) {
    if (!isAttachmentAllowed(file.name) || file.size > maxFileBytes(file.type)) throw badRequest(`${file.name}: file type or size is not allowed`);
    const plan = planStorage(`leads/${leadId}/closure`, file);
    planned.push({
      index, file, ...plan,
      uploadUrl: await createUploadUrl(plan.storagePath),
      thumbnailUploadUrl: plan.thumbnailPath ? await createUploadUrl(plan.thumbnailPath) : null,
    });
  }

  const closure = await prisma.leadClosure.create({
    data: {
      leadId,
      reason: input.reason,
      closedById: actor.userId,
      attachments: {
        create: planned.map(p => ({ leadId, ...attachmentData(p.file, p), status: "PENDING", uploadedById: actor.userId })),
      },
    },
    select: { id: true, attachments: { select: { id: true, storagePath: true } } },
  });
  const byPath = new Map(planned.map(p => [p.storagePath, p]));
  return {
    closureId: closure.id,
    uploads: closure.attachments.map(a => {
      const p = byPath.get(a.storagePath)!;
      return { index: p.index, id: a.id, name: p.file.name, uploadUrl: p.uploadUrl, thumbnailUploadUrl: p.thumbnailUploadUrl };
    }),
    skipped,
  };
}

export async function finishLeadClosure(actor: AuthContext, leadId: string, closureId: string, scope: Scope = "lead") {
  need(actor, "edit", scope);
  const closure = await prisma.leadClosure.findFirst({
    where: { id: closureId, leadId, closedAt: null },
    select: { id: true, reason: true, attachments: { where: { deletedAt: null }, select: { id: true, storagePath: true, thumbnailPath: true, fileName: true, mimeType: true } } },
  });
  if (!closure) throw new ServiceError(404, "This closing was not found, or it was already saved.");
  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { closedAt: true, convertedAt: true } });
  if (!lead) { await abandonClosure(closure); throw notFound(scope); }
  try { inScope(lead, scope); } catch (err) { await abandonClosure(closure); throw err; }
  if (lead.closedAt) { await abandonClosure(closure); throw new ServiceError(409, `This ${scope} is already closed.`); }

  // Check what Storage really holds; one bad file stops the whole closing
  const good: { id: string; size: number; mimeType: string }[] = [];
  for (const a of closure.attachments) {
    const verdict = await verifyUpload(a);
    if (!verdict.ok) {
      await abandonClosure(closure);
      throw badRequest(`${verdict.reason === "Upload not found" ? "A file did not finish uploading" : verdict.reason}. Nothing was saved; please try again.`);
    }
    good.push({ id: a.id, size: verdict.size, mimeType: verdict.mimeType });
  }

  const now = new Date();
  await prisma.$transaction(async tx => {
    for (const g of good) await tx.leadAttachment.update({ where: { id: g.id }, data: { status: "READY", size: g.size, mimeType: g.mimeType } });
    await tx.leadClosure.update({ where: { id: closure.id }, data: { closedAt: now } });
    // Only a lead that is not closed yet can be closed, even if two people try at the same moment
    const closed = await tx.lead.updateMany({ where: { id: leadId, deletedAt: null, closedAt: null, convertedAt: scope === "deal" ? { not: null } : null }, data: { closedAt: now, updatedById: actor.userId } });
    if (closed.count === 0) throw new ServiceError(409, `This ${scope} is already closed.`);
    await audit(tx, actor, leadId, "Closed", { closedAt: null }, { closedAt: now.toISOString(), reason: closure.reason, files: good.length }, scope === "deal" ? (await dealOf(tx, leadId))?.id : undefined);
  }, TX).catch(async err => {
    await abandonClosure(closure);
    throw err;
  });
  return { closedOn: { date: formatDate(now), time: formatTime(now) }, files: good.length };
}

// Opens a closed lead again: the Status column goes back to Open. The closing (reason, files) stays as history.
export async function reopenLead(actor: AuthContext, leadId: string, scope: Scope = "lead") {
  need(actor, "edit", scope);
  const lead = await prisma.lead.findFirst({ where: { id: leadId, deletedAt: null }, select: { closedAt: true, convertedAt: true } });
  if (!lead) throw notFound(scope);
  inScope(lead, scope);
  if (!lead.closedAt) throw new ServiceError(409, `This ${scope} is not closed.`);
  await prisma.$transaction(async tx => {
    const reopened = await tx.lead.updateMany({ where: { id: leadId, deletedAt: null, closedAt: { not: null } }, data: { closedAt: null, updatedById: actor.userId } });
    if (reopened.count === 0) throw new ServiceError(409, `This ${scope} is not closed.`);
    await audit(tx, actor, leadId, "Reopened", { closedAt: lead.closedAt!.toISOString() }, { closedAt: null }, scope === "deal" ? (await dealOf(tx, leadId))?.id : undefined);
  }, TX);
}

// ---------------------------------------------------------------------------
// Convert Lead (Leads → Convert icon). One transaction turns the lead into a deal: the lead is marked converted (Lead.convertedAt), so it
// leaves the Leads list but is kept, its Lead ID unchanged, and a Deal is created for the same customer that points back at it (Deal.leadId).
// Deal numbers DL1, DL2, ... come from their own counter row and never from the Lead ID. Deal Name -> title, Deal Value -> value (the Amount
// on the Deals page), Closing Date -> expectedCloseDate (the Deal Validity). Requirements, staff, location and the rest stay on the lead and
// are read through that link, so nothing is copied twice. A closed lead has to be reopened first.
// ---------------------------------------------------------------------------
export async function nextDealSeq(db: Db): Promise<number> {
  const rows = await db.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES ('deal', 1, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  return Number(rows[0].value);
}

export const dealNumberFor = (seq: number) => `${DEAL_NUMBER_PREFIX}${seq}`;

export async function convertLeadToDeal(actor: AuthContext, leadId: string, input: ConvertLeadInput) {
  need(actor, "edit");
  if (!hasPermission(actor.permissions, "deals", "create")) throw new ServiceError(403, "You do not have permission to create deals.");

  // The Closing Date is a calendar day: today or later, and not absurdly far away
  const today = todayDay();
  if (input.closingDate < today) throw badRequest("Closing Date cannot be in the past");
  const latest = new Date(`${today}T00:00:00Z`);
  latest.setUTCFullYear(latest.getUTCFullYear() + DEAL_CLOSING_MAX_YEARS);
  if (input.closingDate > latest.toISOString().slice(0, 10)) throw badRequest(`Closing Date must be within ${DEAL_CLOSING_MAX_YEARS} years`);
  const value = Math.round(input.dealValue * 100) / 100;
  if (value <= 0) throw badRequest("Deal Value must be more than 0");

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: { leadCode: true, customerId: true, salesExecutiveId: true, closedAt: true, convertedAt: true },
  });
  if (!lead) throw notFound();
  if (lead.convertedAt) throw new ServiceError(409, "This lead was already converted to a deal.");
  if (lead.closedAt) throw new ServiceError(409, "This lead is closed. Reopen it before converting it to a deal.");
  // A lead has to be followed up first: the Follow-up column must show at least one finished follow-up
  const followUps = await prisma.leadFollowUp.count({ where: { leadId, completedAt: { not: null } } });
  if (followUps < MIN_FOLLOWUPS_TO_CONVERT) throw new ServiceError(409, FOLLOWUP_NEEDED_MESSAGE);
  const firstStatus = await prisma.leadOption.findFirst({ where: { type: "DEAL_STATUS" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { id: true } });

  return prisma.$transaction(async tx => {
    const now = new Date();
    // Only an open lead that has not been converted yet can be converted, even if two people press Convert at the same moment
    const marked = await tx.lead.updateMany({ where: { id: leadId, deletedAt: null, convertedAt: null, closedAt: null }, data: { convertedAt: now, updatedById: actor.userId } });
    if (marked.count === 0) throw new ServiceError(409, "This lead was just converted, closed or removed. Refresh the page.");
    // Take the number last, so the counter row is locked for as short a time as possible
    const dealNumber = dealNumberFor(await nextDealSeq(tx));
    const deal = await tx.deal.create({
      data: {
        dealNumber,
        leadId,
        customerId: lead.customerId,
        title: input.dealName,
        value,
        expectedCloseDate: new Date(`${input.closingDate}T00:00:00.000Z`),
        salesExecutiveId: lead.salesExecutiveId,
        dealStatusId: firstStatus?.id ?? null,
        createdAt: now,
      },
      select: { id: true },
    });
    await tx.cRMAuditLog.create({
      data: {
        entityType: "Lead",
        entityId: leadId,
        leadId,
        dealId: deal.id,
        action: "Converted",
        performedById: actor.employeeId,
        oldValue: JSON.stringify({ convertedAt: null }),
        newValue: JSON.stringify({ convertedAt: now.toISOString(), dealNumber, dealName: input.dealName, closingDate: input.closingDate, dealValue: value }),
      },
    });
    return { dealId: deal.id, dealNumber, leadCode: lead.leadCode };
  }, TX);
}
