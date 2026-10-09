// What the pick-lists of the record forms are made of: the active CRM users, the deals made with Convert (DL1, DL2, ...) and the
// Material / Service Vendors. Nothing is hard-coded: a new user, deal or vendor shows up in the next list that is opened.

import { prisma } from "@/lib/db";
import { loadAuthState } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/effective";
import { DEAL_NUMBER_PREFIX } from "@/lib/leads/constants";
import { MODULES, PROJECT_TEMPLATE_FIELD } from "./registry";
import { getLayout } from "./layout";
import { isId } from "./values";
import type { FieldOption, LookupItem, ModuleId, RecordRefs } from "./types";

const LIMIT = 250;

const contains = (q: string) => ({ contains: q, mode: "insensitive" as const });

// Every active user: they can be chosen as Task Person / Owner. Inactive, suspended and deleted users are not offered.
export async function activeUsers(): Promise<LookupItem[]> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true, employee: { select: { designation: true } } },
    take: 1000,
  });
  return users.map(u => ({ id: u.id, label: u.name?.trim() || u.email || "Unnamed", sub: u.employee?.designation ?? null }));
}

// The people who may be shown in Approved By: active users who hold the module's Approve permission
export async function approvers(moduleId: ModuleId): Promise<LookupItem[]> {
  const permission = MODULES[moduleId].permission;
  const users = await activeUsers();
  const states = await Promise.all(users.map(u => loadAuthState(u.id)));
  return users.filter((_, i) => !!states[i] && hasPermission(states[i]!.permissions, permission, "approve"));
}

export async function searchDeals(q: string, customerId?: string): Promise<LookupItem[]> {
  const text = q.trim();
  const deals = await prisma.deal.findMany({
    where: {
      deletedAt: null,
      dealNumber: { startsWith: DEAL_NUMBER_PREFIX },
      ...(customerId && isId(customerId) ? { customerId } : {}),
      ...(text ? { OR: [{ dealNumber: contains(text) }, { title: contains(text) }, { lead: { is: { customerName: contains(text) } } }] } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: { id: true, dealNumber: true, title: true, customerId: true, projectConvertedAt: true, lead: { select: { customerName: true, closedAt: true } } },
  });
  return deals.map(d => ({
    id: d.id,
    label: d.dealNumber ?? d.id,
    sub: [d.title, d.lead.customerName].filter(Boolean).join(" · ") || null,
    tag: d.projectConvertedAt ? "Converted" : d.lead.closedAt ? "Closed" : null,
    data: { customerId: d.customerId },
  }));
}

// The project templates (Gypsum False Ceiling, Painting ...): the options of the Template dropdown in Project → Edit Page Layout, so a
// Super Admin adds one in a single place and it is offered in Vendor Selection and as the Work Type of a Pre-Payment Record
export async function projectTemplates(): Promise<FieldOption[]> {
  const layout = await getLayout("project");
  return layout.fields.find(f => f.key === PROJECT_TEMPLATE_FIELD)?.options ?? [];
}

export async function searchTemplates(q: string): Promise<LookupItem[]> {
  const text = q.trim().toLowerCase();
  return (await projectTemplates()).filter(o => !text || o.label.toLowerCase().includes(text)).slice(0, 50).map(o => ({ id: o.id, label: o.label }));
}

export async function searchMaterialVendors(q: string): Promise<LookupItem[]> {
  const text = q.trim();
  const rows = await prisma.materialVendor.findMany({
    where: { deletedAt: null, ...(text ? { OR: [{ code: contains(text) }, { companyName: contains(text) }, { city: contains(text) }] } : {}) },
    orderBy: { seq: "desc" },
    take: LIMIT,
    select: { id: true, code: true, companyName: true, city: true },
  });
  return rows.map(v => ({ id: v.id, label: v.code, sub: [v.companyName, v.city].filter(Boolean).join(" · ") }));
}

export async function searchServiceVendors(q: string): Promise<LookupItem[]> {
  const text = q.trim();
  const rows = await prisma.serviceVendor.findMany({
    where: { deletedAt: null, ...(text ? { OR: [{ code: contains(text) }, { name: contains(text) }, { companyName: contains(text) }, { city: contains(text) }] } : {}) },
    orderBy: { seq: "desc" },
    take: LIMIT,
    select: { id: true, code: true, name: true, city: true },
  });
  return rows.map(v => ({ id: v.id, label: v.code, sub: [v.name, v.city].filter(Boolean).join(" · ") }));
}

// ---------------------------------------------------------------------------
// Names for the ids a record holds (the people and records a record points to, even if they are inactive or deleted by now)
// ---------------------------------------------------------------------------
export type RefIds = { users: Set<string>; deals: Set<string>; materialVendors: Set<string>; serviceVendors: Set<string>; customers: Set<string>; projects: Set<string>; templates: Set<string> };
export const emptyRefIds = (): RefIds => ({ users: new Set(), deals: new Set(), materialVendors: new Set(), serviceVendors: new Set(), customers: new Set(), projects: new Set(), templates: new Set() });

export async function buildRefs(ids: RefIds): Promise<RecordRefs> {
  const [users, deals, materialVendors, serviceVendors, customers, projects, templates] = await Promise.all([
    ids.users.size ? prisma.user.findMany({ where: { id: { in: Array.from(ids.users) } }, select: { id: true, name: true, email: true } }) : [],
    ids.deals.size
      ? prisma.deal.findMany({
          where: { id: { in: Array.from(ids.deals) } },
          // projects: a converted deal is not in the Deals list any more, so a record that points at it links to its project instead
          select: { id: true, dealNumber: true, title: true, lead: { select: { customerName: true, closedAt: true } }, projects: { where: { deletedAt: null }, select: { id: true }, take: 1 } },
        })
      : [],
    ids.materialVendors.size ? prisma.materialVendor.findMany({ where: { id: { in: Array.from(ids.materialVendors) } }, select: { id: true, code: true, companyName: true } }) : [],
    ids.serviceVendors.size ? prisma.serviceVendor.findMany({ where: { id: { in: Array.from(ids.serviceVendors) } }, select: { id: true, code: true, name: true } }) : [],
    ids.customers.size ? prisma.customer.findMany({ where: { id: { in: Array.from(ids.customers) } }, select: { id: true, name: true } }) : [],
    ids.projects.size ? prisma.project.findMany({ where: { id: { in: Array.from(ids.projects) } }, select: { id: true, name: true } }) : [],
    ids.templates.size ? projectTemplates() : [],
  ]);
  return {
    users: Object.fromEntries(users.map(u => [u.id, u.name?.trim() || u.email || "Unnamed"])),
    deals: Object.fromEntries(deals.map(d => [d.id, { code: d.dealNumber ?? "", name: d.title, customer: d.lead.customerName, closed: !!d.lead.closedAt, projectId: d.projects[0]?.id ?? null }])),
    materialVendors: Object.fromEntries(materialVendors.map(v => [v.id, { code: v.code, name: v.companyName }])),
    serviceVendors: Object.fromEntries(serviceVendors.map(v => [v.id, { code: v.code, name: v.name }])),
    lookups: {
      customer: Object.fromEntries(customers.map(c => [c.id, c.name])),
      project: Object.fromEntries(projects.map(p => [p.id, p.name])),
      template: Object.fromEntries(templates.filter(o => ids.templates.has(o.id)).map(o => [o.id, o.label])),
    },
  };
}
