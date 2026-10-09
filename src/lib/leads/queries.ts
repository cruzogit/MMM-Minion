import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COLUMN_FILTER_KEYS, COLUMN_FILTER_MAX_VALUES, LEAD_FILTERS, leadStatusText, OPTION_TYPES, PAGE_SIZE, SORT_KEYS, type ColumnFilters, type EmployeeOptionDto, type LeadFilterId, type LeadFormOptions, type LeadOptionDto, type LeadSortKey, type OptionType } from "./constants";
import { formatDate, formatTime, todayBounds } from "./format";
import { getColumnOrder, getLayout } from "./layout";

export type LeadListParams = {
  q?: string;
  filter?: LeadFilterId;
  sort?: LeadSortKey;
  dir?: "asc" | "desc";
  page?: number;
  from?: string; // YYYY-MM-DD, first and last day of the calendar range, in the CRM time zone
  to?: string;
  dateBy?: "last" | "next" | "validity"; // the date the range applies to: the last / next follow-up (or, on the Deals page, the Deal Validity). Absent = Assigned Date (when the lead was created and assigned), or the Deal Created date
  cols?: ColumnFilters; // column header tick-box filters; several values in one column = OR, different columns = AND
  limit?: number;
};

export const personSelect = { id: true, designation: true, user: { select: { name: true } } } as const;
export const optionSelect = { id: true, label: true, key: true } as const;

export const rowSelect = {
  id: true,
  leadSeq: true,
  leadCode: true,
  leadNumber: true,
  createdAt: true,
  customerName: true,
  contactNumber: true,
  exactRequirement: true,
  requirement: true,
  siteLocation: true,
  source: true,
  amount: true,
  expectedValue: true,
  conventionalRate: true,
  notes: true,
  location: true,
  exactLocation: true,
  locationLink: true,
  dailyTask: true,
  customFields: true,
  productOrServiceId: true,
  requirementId: true,
  modeOfCustomerId: true,
  sourceId: true,
  mainCategoryId: true,
  subcategoryId: true,
  leadStatusId: true,
  closedAt: true,
  convertedAt: true,
  leadTypeId: true,
  salesExecutiveId: true,
  leadPersonId: true,
  customer: { select: { name: true, phone: true } },
  salesExecutive: { select: personSelect },
  leadPerson: { select: personSelect },
  productOrService: { select: optionSelect },
  requirementOption: { select: optionSelect },
  modeOfCustomer: { select: optionSelect },
  sourceOption: { select: optionSelect },
  mainCategory: { select: optionSelect },
  subcategory: { select: optionSelect },
  leadStatus: { select: optionSelect },
  leadType: { select: optionSelect },
  leadFollowUps: { where: { completedAt: { not: null } }, orderBy: { completedAt: "desc" }, take: 1, select: { completedAt: true, nextAt: true } },
  _count: { select: { attachments: { where: { status: "READY", deletedAt: null, followUpId: null, closureId: null } }, leadFollowUps: { where: { completedAt: { not: null } } } } },
} satisfies Prisma.LeadSelect;

export type RowRecord = Prisma.LeadGetPayload<{ select: typeof rowSelect }>;

export type LeadRow = ReturnType<typeof toRow>;

export function person(p: RowRecord["salesExecutive"]) {
  return p ? { id: p.id, name: p.user?.name ?? "—", designation: p.designation } : null;
}

export function toRow(l: RowRecord) {
  return {
    id: l.id,
    code: l.leadCode ?? l.leadNumber ?? "—",
    date: formatDate(l.createdAt),
    time: formatTime(l.createdAt),
    createdAt: l.createdAt.toISOString(),
    productOrServiceLabel: l.productOrService?.label ?? null,
    customerName: l.customerName ?? l.customer?.name ?? "—",
    contactNumber: l.contactNumber ?? l.customer?.phone ?? "",
    leadTypeLabel: l.leadType?.label ?? null,
    requirementLabel: l.requirementOption?.label ?? null,
    exactRequirement: l.exactRequirement ?? l.requirement ?? null,
    amount: l.amount !== null ? Number(l.amount) : l.expectedValue !== null ? Number(l.expectedValue) : null,
    taskPerson: person(l.salesExecutive),
    leadPerson: person(l.leadPerson),
    leadStatus: l.leadStatus ? { id: l.leadStatus.id, label: l.leadStatus.label, key: l.leadStatus.key } : null,
    isClosed: l.closedAt !== null, // closed through Close Lead: the Status column says Closed and the reason is on record
    isConverted: l.convertedAt !== null, // converted to a deal (Convert): it left the Leads list and lives on the Deals page
    status: leadStatusText(l.closedAt !== null, l._count.leadFollowUps), // what the Status column shows: Open / Follow-up / Closed
    notes: l.notes,
    conventionalRate: l.conventionalRate !== null ? Number(l.conventionalRate) : null,
    sourceLabel: l.sourceOption?.label ?? l.source ?? null,
    modeOfCustomerLabel: l.modeOfCustomer?.label ?? null,
    mainCategoryLabel: l.mainCategory?.label ?? null,
    subcategoryLabel: l.subcategory?.label ?? null,
    location: l.location ?? l.siteLocation ?? null,
    exactLocation: l.exactLocation,
    locationLink: l.locationLink,
    dailyTask: l.dailyTask,
    customFields: ((l.customFields ?? {}) as Record<string, string | number | boolean>),
    attachmentCount: l._count.attachments,
    followUpCount: l._count.leadFollowUps,
    lastFollowUp: l.leadFollowUps[0]?.completedAt ? { date: formatDate(l.leadFollowUps[0].completedAt), time: formatTime(l.leadFollowUps[0].completedAt) } : null,
    nextFollowUp: l.leadFollowUps[0]?.nextAt ? { date: formatDate(l.leadFollowUps[0].nextAt), time: formatTime(l.leadFollowUps[0].nextAt) } : null,
    ids: {
      taskAssignedPersonId: l.salesExecutiveId,
      leadPersonId: l.leadPersonId,
      productOrServiceId: l.productOrServiceId,
      requirementId: l.requirementId,
      modeOfCustomerId: l.modeOfCustomerId,
      sourceId: l.sourceId,
      mainCategoryId: l.mainCategoryId,
      subcategoryId: l.subcategoryId,
      leadStatusId: l.leadStatusId,
      leadTypeId: l.leadTypeId,
    },
  };
}

function orderBy(sort: LeadSortKey | undefined, dir: "asc" | "desc"): Prisma.LeadOrderByWithRelationInput[] {
  const tie: Prisma.LeadOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
  switch (sort) {
    case "customer": return [{ customerName: { sort: dir, nulls: "last" } }, ...tie];
    case "requirement": return [{ exactRequirement: { sort: dir, nulls: "last" } }, ...tie];
    case "assigned": return [{ leadPerson: { user: { name: dir } } }, ...tie]; // the Staff Assignment column shows the Lead Person first
    case "status": return [{ leadStatus: { label: dir } }, ...tie];
    case "source": return [{ sourceOption: { label: dir } }, ...tie];
    case "category": return [{ mainCategory: { label: dir } }, ...tie];
    case "location": return [{ location: { sort: dir, nulls: "last" } }, ...tie];
    case "lead":
    default:
      return [{ leadSeq: { sort: dir, nulls: "last" } }, ...tie];
  }
}

export function parseListParams(sp: Record<string, string | string[] | undefined>): LeadListParams {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const filter = one("filter");
  const sort = one("sort");
  const day = (k: string) => { const v = one(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined; };
  const dateBy = one("dateBy");
  let from = day("from");
  let to = day("to");
  if (from && to && from > to) [from, to] = [to, from]; // a reversed range is put in order
  const cols: ColumnFilters = {};
  for (const k of COLUMN_FILTER_KEYS) {
    const raw = one(`f_${k}`);
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) continue;
      const vals = arr.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200).slice(0, COLUMN_FILTER_MAX_VALUES);
      if (vals.length) cols[k] = vals;
    } catch { /* ignore a malformed value */ }
  }
  return {
    cols,
    from,
    to,
    dateBy: dateBy === "last" || dateBy === "next" || dateBy === "validity" ? dateBy : undefined,
    q: one("q")?.trim().slice(0, 100) || undefined,
    filter: LEAD_FILTERS.some(f => f.id === filter) ? (filter as LeadListParams["filter"]) : undefined,
    sort: (SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as LeadSortKey) : undefined,
    dir: one("dir") === "asc" ? "asc" : "desc",
    page: Math.max(1, Number(one("page")) || 1),
    limit: one("limit") ? Math.max(10, Math.min(1000, Number(one("limit")) || PAGE_SIZE)) : undefined,
  };
}

// The rules behind the Status column (see leadStatusText), used by its column filter and by the quick filter buttons
function statusWhere(status: string): Prisma.LeadWhereInput | null {
  switch (status) {
    case "open": return { closedAt: null, leadFollowUps: { none: { completedAt: { not: null } } } };
    case "follow_up": return { closedAt: null, leadFollowUps: { some: { completedAt: { not: null } } } };
    case "closed": return { closedAt: { not: null } };
    default: return null;
  }
}

export type ListScope = "lead" | "deal";

// What the search box looks for in a lead. The Deals page does not look at the Lead Status (a deal has its own status)
export function searchTerms(q: string, scope: ListScope = "lead"): Prisma.LeadWhereInput[] {
  const contains = { contains: q, mode: "insensitive" as const };
  const digits = q.replace(/\D/g, "");
  return [
    { leadCode: contains },
    { leadNumber: contains },
    { customerName: contains },
    { contactNumber: contains },
    ...(digits.length >= 3 ? [{ contactNumber: { contains: digits } }] : []),
    { exactRequirement: contains },
    { requirement: contains },
    { requirementOption: { label: contains } },
    { salesExecutive: { user: { name: contains } } },
    { leadPerson: { user: { name: contains } } },
    { sourceOption: { label: contains } },
    { source: contains },
    { mainCategory: { label: contains } },
    { subcategory: { label: contains } },
    { location: contains },
    { exactLocation: contains },
    { siteLocation: contains },
    ...(scope === "lead" ? [{ leadStatus: { label: contains } }] : []),
    { customer: { name: contains } },
    { customer: { phone: contains } },
  ];
}

// The calendar's From / To as whole days in the CRM time zone (null when no range is set)
export function dateRange(params: Pick<LeadListParams, "from" | "to">): { gte?: Date; lt?: Date } | null {
  if (!params.from && !params.to) return null;
  return {
    ...(params.from ? { gte: todayBounds(new Date(`${params.from}T12:00:00Z`))[0] } : {}),
    ...(params.to ? { lt: todayBounds(new Date(`${params.to}T12:00:00Z`))[1] } : {}),
  };
}

// One list builder for both pages. The Leads page lists the leads that were not converted; the Deals page lists the converted ones
// (its rows are deals, which add their own search, Deal Status, Deal Created and Deal Validity conditions on top of what is built here).
export async function buildWhere(params: Pick<LeadListParams, "q" | "cols" | "from" | "to" | "dateBy" | "filter">, scope: ListScope = "lead"): Promise<Prisma.LeadWhereInput> {
  const and: Prisma.LeadWhereInput[] = [scope === "deal" ? { deletedAt: null, convertedAt: { not: null } } : { deletedAt: null, convertedAt: null }];

  if (params.q && scope === "lead") and.push({ OR: searchTerms(params.q, scope) });

  const c = params.cols ?? {};
  if (c.customer) and.push({ customerName: { in: c.customer } });
  if (c.requirement) and.push({ exactRequirement: { in: c.requirement } });
  if (c.assigned) and.push({ salesExecutiveId: { in: c.assigned } });
  if (c.leadPerson) and.push({ leadPersonId: { in: c.leadPerson } });
  if (c.status && scope === "lead") and.push({ leadStatusId: { in: c.status } }); // on the Deals page this column is the Deal Status, a field of the deal
  // Status column: any of the ticked values. Values that are not one of the three match nothing, like an unknown id in the other columns
  // (an empty OR is not used for that: the query engine treats it as "no condition")
  if (c.state) {
    const any = c.state.flatMap(v => { const w = statusWhere(v); return w ? [w] : []; });
    and.push(any.length ? { OR: any } : { id: "" });
  }
  if (c.source) and.push({ sourceId: { in: c.source } });
  if (c.category) and.push({ mainCategoryId: { in: c.category } });
  if (c.location) and.push({ location: { in: c.location } });

  // Calendar range, whole days in the CRM time zone. The funnel chooses the date it applies to: when the lead was assigned
  // (created), its recorded last follow-up, or its recorded next follow-up. A lead without that date never matches a range.
  const range = dateRange(params);
  if (range) {
    if (params.dateBy === "last") and.push({ lastContactedAt: range });
    else if (params.dateBy === "next") and.push({ nextActionDate: range });
    else if (scope === "lead") and.push({ createdAt: range });
  }

  if (params.filter === "today_followup") {
    const [start, end] = todayBounds();
    and.push({ nextActionDate: { gte: start, lt: end } });
  } else if (params.filter) {
    const f = LEAD_FILTERS.find(x => x.id === params.filter); // the Deals page uses the same ids (its buttons are only named differently)
    // Same rules as the Status column: Closed, else Follow-up once a follow-up is finished, else Open
    const byStatus = f?.status ? statusWhere(f.status) : null;
    if (byStatus) and.push(byStatus);
    else if (f?.statusKey) and.push({ leadStatus: { key: f.statusKey } });
  }
  return { AND: and };
}

export async function listLeads(params: LeadListParams) {
  const page = params.page ?? 1;
  const limit = params.limit ?? PAGE_SIZE;
  const where = await buildWhere(params);
  const [rows, filteredTotal, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      select: rowSelect,
      orderBy: orderBy(params.sort, params.dir === "asc" ? "asc" : "desc"),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.lead.count({ where }),
    prisma.lead.count({ where: { deletedAt: null, convertedAt: null } }),
  ]);
  return {
    rows: rows.map(toRow),
    summary: { total, showing: filteredTotal },
    page,
    pageCount: Math.max(1, Math.ceil(filteredTotal / limit)),
    pageSize: limit,
  };
}

// For CSV download: same filters, no paging, capped
export async function listLeadsForExport(params: LeadListParams, max = 10000) {
  const where = await buildWhere(params);
  const rows = await prisma.lead.findMany({ where, select: rowSelect, orderBy: orderBy(params.sort, params.dir === "asc" ? "asc" : "desc"), take: max });
  return rows.map(toRow);
}

export async function getLeadRow(id: string) {
  const lead = await prisma.lead.findFirst({ where: { id, deletedAt: null }, select: rowSelect });
  return lead ? toRow(lead) : null;
}

export async function getFormOptions(): Promise<LeadFormOptions> {
  const [options, employees, fields, customers, locations, requirementTexts, columnOrder] = await Promise.all([
    prisma.leadOption.findMany({
      where: { OR: [{ type: { in: [...OPTION_TYPES] } }, { type: { startsWith: "CF:" } }] },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { id: true, type: true, key: true, label: true, parentId: true },
    }),
    prisma.employee.findMany({
      where: { user: { deletedAt: null, status: "ACTIVE" } },
      orderBy: { user: { name: "asc" } },
      select: { id: true, designation: true, user: { select: { name: true } } },
    }),
    getLayout(),
    prisma.lead.findMany({ where: { deletedAt: null, convertedAt: null, customerName: { not: null } }, distinct: ["customerName"], select: { customerName: true }, orderBy: { customerName: "asc" }, take: 1000 }),
    prisma.lead.findMany({ where: { deletedAt: null, convertedAt: null, location: { not: null } }, distinct: ["location"], select: { location: true }, orderBy: { location: "asc" }, take: 1000 }),
    prisma.lead.findMany({ where: { deletedAt: null, convertedAt: null, exactRequirement: { not: null } }, distinct: ["exactRequirement"], select: { exactRequirement: true }, orderBy: { exactRequirement: "asc" }, take: 1000 }),
    getColumnOrder(),
  ]);
  const customOptions: Record<string, LeadOptionDto[]> = {};
  for (const f of fields) if (!f.isSystem && f.optionType) customOptions[f.key] = options.filter(o => o.type === f.optionType) as LeadOptionDto[];
  const of = (type: OptionType) => options.filter(o => o.type === type) as LeadOptionDto[];
  const emp: EmployeeOptionDto[] = employees.map(e => ({ id: e.id, name: e.user.name ?? "Unnamed", designation: e.designation }));
  return {
    sources: of("SOURCE"),
    requirements: of("REQUIREMENT"),
    modesOfCustomer: of("MODE_OF_CUSTOMER"),
    productOrService: of("PRODUCT_OR_SERVICE"),
    mainCategories: of("MAIN_CATEGORY"),
    subcategories: of("SUBCATEGORY"),
    leadStatuses: of("LEAD_STATUS"),
    dealStatuses: of("DEAL_STATUS"),
    leadTypes: of("LEAD_TYPE"),
    employees: emp,
    exactRequirements: requirementTexts.map(r => r.exactRequirement!).filter(Boolean),
    columnOrder,
    customerNames: customers.map(c => c.customerName!).filter(Boolean),
    locations: locations.map(l => l.location!).filter(Boolean),
    fields,
    customOptions,
  };
}
