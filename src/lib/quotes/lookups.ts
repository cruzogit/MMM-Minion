// The pick-lists of the quote form, read from the live CRM data: customers, the projects of a customer, the items of the catalogue.
// A new customer, project or item shows up in the next list that is opened. (A customer is added and corrected with the Customer form: src/lib/customers.)

import { prisma } from "@/lib/db";
import { isId } from "@/lib/records/values";
import type { LookupItem } from "@/lib/records/types";
import { CUSTOMER_SELECT, toCustomer } from "@/lib/customers/dto";
import { itemSearch, loadItemExtras, toItem } from "./catalog";
import type { CustomerDto, ItemDto } from "./types";

const LIMIT = 250;
const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

// Found by the name, the company, the contact's name, a phone number, the email or the customer number
export async function searchCustomers(q: string): Promise<(LookupItem & { customer: CustomerDto })[]> {
  const text = q.trim();
  const rows = await prisma.customer.findMany({
    where: text
      ? { OR: [{ name: contains(text) }, { companyName: contains(text) }, { firstName: contains(text) }, { lastName: contains(text) }, { phone: contains(text) }, { workPhone: contains(text) }, { email: contains(text) }, { customerCode: contains(text) }] }
      : {},
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: LIMIT,
    select: CUSTOMER_SELECT,
  });
  return rows.map(c => ({ id: c.id, label: c.name, sub: [c.phone, c.email].filter(Boolean).join(" · ") || null, tag: c.status === "Active" ? null : c.status, customer: toCustomer(c) }));
}

export async function getCustomer(id: string): Promise<CustomerDto | null> {
  if (!isId(id)) return null;
  const c = await prisma.customer.findUnique({ where: { id }, select: CUSTOMER_SELECT });
  return c ? toCustomer(c) : null;
}

// The projects of one customer (nothing is offered before a customer is chosen)
export async function searchProjects(q: string, customerId: string | undefined): Promise<LookupItem[]> {
  if (!customerId || !isId(customerId)) return [];
  const text = q.trim();
  const rows = await prisma.project.findMany({
    where: { customerId, deletedAt: null, ...(text ? { OR: [{ name: contains(text) }, { projectCode: contains(text) }] } : {}) },
    orderBy: { name: "asc" },
    take: LIMIT,
    select: { id: true, name: true, status: true, dealId: true, projectCode: true },
  });
  // a project of the Projects module is told by its code (MP1); its status is an option id there, so it is not shown as text
  return rows.map(p => ({ id: p.id, label: p.projectCode ? `${p.projectCode} · ${p.name}` : p.name, sub: p.projectCode ? null : p.status, tag: null }));
}

// The items of the Items module that a quote can pick (the ones that are switched on), by name, description, HSN/SAC, SKU, category, brand, manufacturer or Item ID.
// `offset` asks for the next matches: the list of the picker goes on as it is scrolled, so all the items can be reached.
export async function searchCatalog(q: string, limit = LIMIT, offset = 0): Promise<ItemDto[]> {
  const text = q.trim();
  const rows = await prisma.catalogItem.findMany({
    where: { deletedAt: null, isActive: true, ...(text ? itemSearch(text) : {}) },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    skip: Math.max(0, Math.min(1_000_000, offset)),
    take: Math.min(200, limit),
  });
  const x = await loadItemExtras(rows.map(r => r.id));
  return rows.map(r => toItem(r, x));
}
