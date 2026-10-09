import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DEAL_NUMBER_PREFIX, PAGE_SIZE } from "@/lib/leads/constants";
import { formatDealStamp, formatDealValidity } from "@/lib/leads/format";
import { buildWhere, dateRange, parseListParams, rowSelect, searchTerms, toRow, type LeadListParams } from "@/lib/leads/queries";
import { CONVERTED_FILTER, DEAL_SORT_KEYS, type DealFilterId, type DealSortKey } from "./constants";

// The Deals page works like the Leads page: the same search, column filters, quick filters and dates. Its rows are deals;
// everything about the customer, requirements, staff, follow-ups and so on is read from the lead the deal was made from.
export type DealListParams = Omit<LeadListParams, "sort" | "filter"> & { sort?: DealSortKey; filter?: DealFilterId };

const dealSelect = {
  id: true,
  leadId: true,
  dealNumber: true,
  title: true,
  value: true,
  expectedCloseDate: true,
  createdAt: true,
  projectConvertedAt: true,
  dealStatus: { select: { id: true, label: true, key: true } },
  projects: { where: { deletedAt: null }, select: { id: true, projectCode: true }, take: 1 }, // the project a converted deal became
  lead: { select: rowSelect },
} satisfies Prisma.DealSelect;

type DealRecord = Prisma.DealGetPayload<{ select: typeof dealSelect }>;

export type DealRow = ReturnType<typeof toDealRow>;

// A DealRow is a LeadRow (what the lead behind the deal shows) with the deal's own details on top. Its id is the DEAL's id, so every
// request from the Deals page is about the deal; `code` is the Deal ID (DL1) and `leadCode` the original Lead ID, which never changes.
export function toDealRow(d: DealRecord) {
  const lead = toRow(d.lead);
  return {
    ...lead,
    id: d.id,
    leadId: d.leadId,
    code: d.dealNumber ?? "—",
    leadCode: lead.code,
    amount: Number(d.value), // the Deal Value typed when the lead was converted
    deal: {
      name: d.title,
      value: Number(d.value),
      created: formatDealStamp(d.createdAt), // 04-10-2026, 06:30 PM: when the lead was converted
      leadCreated: formatDealStamp(d.lead.createdAt),
      validity: d.expectedCloseDate ? formatDealValidity(d.expectedCloseDate) : null, // 15-10-2026
      closingDate: d.expectedCloseDate ? d.expectedCloseDate.toISOString().slice(0, 10) : null, // 2026-10-15, for the edit form
      status: d.dealStatus ? { id: d.dealStatus.id, label: d.dealStatus.label, key: d.dealStatus.key } : null, // the Deal Status
    },
    // Convert to Project: the deal stays, but only the Converted Deals filter lists it, with the project it became
    isProjectConverted: d.projectConvertedAt !== null,
    projectId: d.projects[0]?.id ?? null,
    projectCode: d.projects[0]?.projectCode ?? null,
  };
}

// Only deals made by Convert (DL numbers) are listed, and deleted ones are not; the older CRM page keeps its own deals
export const live: Prisma.DealWhereInput = { dealNumber: { startsWith: DEAL_NUMBER_PREFIX }, deletedAt: null, lead: { deletedAt: null, convertedAt: { not: null } } };
// The normal views leave out the deals that became projects; the Converted Deals filter shows only those
const normalDeals: Prisma.DealWhereInput = { ...live, projectConvertedAt: null };
const convertedDeals: Prisma.DealWhereInput = { ...live, projectConvertedAt: { not: null } };

function orderBy(sort: DealSortKey | undefined, dir: "asc" | "desc"): Prisma.DealOrderByWithRelationInput[] {
  const tie: Prisma.DealOrderByWithRelationInput[] = [{ createdAt: "desc" }, { id: "desc" }];
  switch (sort) {
    case "customer": return [{ lead: { customerName: { sort: dir, nulls: "last" } } }, ...tie];
    case "requirement": return [{ lead: { exactRequirement: { sort: dir, nulls: "last" } } }, ...tie];
    case "assigned": return [{ lead: { leadPerson: { user: { name: dir } } } }, ...tie]; // like the Leads page: the Lead Person is shown first
    case "status": return [{ dealStatus: { label: dir } }, ...tie];
    case "source": return [{ lead: { sourceOption: { label: dir } } }, ...tie];
    case "category": return [{ lead: { mainCategory: { label: dir } } }, ...tie];
    case "location": return [{ lead: { location: { sort: dir, nulls: "last" } } }, ...tie];
    case "validity": return [{ expectedCloseDate: { sort: dir, nulls: "last" } }, ...tie];
    case "deal":
    default:
      return [{ createdAt: dir }, { id: dir }]; // DL numbers are given out in the order deals are made
  }
}

export function parseDealParams(sp: Record<string, string | string[] | undefined>): DealListParams {
  const { sort: _leadSort, filter: leadFilter, ...params } = parseListParams(sp); // eslint-disable-line @typescript-eslint/no-unused-vars
  const sort = typeof sp.sort === "string" ? sp.sort : undefined;
  const filter: DealFilterId | undefined = sp.filter === CONVERTED_FILTER ? CONVERTED_FILTER : leadFilter;
  return { ...params, filter, sort: (DEAL_SORT_KEYS as readonly string[]).includes(sort ?? "") ? (sort as DealSortKey) : undefined };
}

const isConvertedView = (params: DealListParams) => params.filter === CONVERTED_FILTER;

async function buildDealWhere(params: DealListParams): Promise<Prisma.DealWhereInput> {
  // The Converted Deals filter is about the deal, not about its lead's status: the lead rules (Open / Follow-up ...) are not applied to it
  const leadParams = { ...params, filter: params.filter === CONVERTED_FILTER ? undefined : params.filter };
  const and: Prisma.DealWhereInput[] = [isConvertedView(params) ? convertedDeals : normalDeals, { lead: await buildWhere(leadParams, "deal") }];

  if (params.q) {
    const contains = { contains: params.q, mode: "insensitive" as const };
    // the lead's own fields (customer, requirements, staff, ...) and the deal's: its number, name and Deal Status
    and.push({ OR: [{ dealNumber: contains }, { title: contains }, { dealStatus: { label: contains } }, { lead: { OR: searchTerms(params.q, "deal") } }] });
  }
  if (params.cols?.status) and.push({ dealStatusId: { in: params.cols.status } }); // the Deal Status column

  // The calendar: Deal Created Date and Deal Validity belong to the deal (the follow-up dates were applied to the lead above)
  const range = dateRange(params);
  if (range && params.dateBy !== "last" && params.dateBy !== "next") and.push(params.dateBy === "validity" ? { expectedCloseDate: range } : { createdAt: range });
  return { AND: and };
}

export async function listDeals(params: DealListParams) {
  const page = params.page ?? 1;
  const limit = params.limit ?? PAGE_SIZE;
  const where = await buildDealWhere(params);
  const [rows, filtered, total] = await Promise.all([
    prisma.deal.findMany({
      where,
      select: dealSelect,
      orderBy: orderBy(params.sort, params.dir === "asc" ? "asc" : "desc"),
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.deal.count({ where }),
    prisma.deal.count({ where: isConvertedView(params) ? convertedDeals : normalDeals }), // Total Deals: the deals of the view that is open
  ]);
  return {
    rows: rows.map(toDealRow),
    summary: { total, showing: filtered },
    page,
    pageCount: Math.max(1, Math.ceil(filtered / limit)),
    pageSize: limit,
  };
}

// For CSV download: same filters, no paging, capped
export async function listDealsForExport(params: DealListParams, max = 10000) {
  const where = await buildDealWhere(params);
  const rows = await prisma.deal.findMany({ where, select: dealSelect, orderBy: orderBy(params.sort, params.dir === "asc" ? "asc" : "desc"), take: max });
  return rows.map(toDealRow);
}

// The values offered in the Customer, Requirements and Location header filters: only those that exist among the deals
export async function getDealFilterLists() {
  const rows = await prisma.deal.findMany({
    where: live,
    select: { lead: { select: { customerName: true, exactRequirement: true, location: true } } },
    take: 2000,
  });
  const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));
  return {
    customerNames: unique(rows.map(r => r.lead.customerName)),
    requirements: unique(rows.map(r => r.lead.exactRequirement)),
    locations: unique(rows.map(r => r.lead.location)),
  };
}
