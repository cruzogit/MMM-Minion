// Single source of truth for CRM modules, actions and the routes they guard.
// `scripts/rbac-sync.ts` writes these into the Permission table; this file has
// no server-only imports so the proxy, server code and client UI can all use it.

export const ACTIONS = ["view", "create", "edit", "delete", "approve", "export"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABELS: Record<Action, string> = {
  view: "View",
  create: "Create",
  edit: "Edit",
  delete: "Delete",
  approve: "Approve",
  export: "Export",
};

export type ModuleDef = { key: string; label: string; group: string };

export const MODULES = [
  { key: "dashboard", label: "Dashboard", group: "General" },
  { key: "leads", label: "Leads", group: "CRM" },
  { key: "requirements", label: "Requirements", group: "CRM" },
  { key: "quotes", label: "Quotes", group: "CRM" },
  { key: "site_visits", label: "Site Visits", group: "CRM" },
  { key: "deals", label: "Deals", group: "CRM" },
  { key: "projects", label: "Projects", group: "Delivery" },
  { key: "boq", label: "BOQ", group: "Delivery" },
  { key: "tasks", label: "Tasks", group: "Delivery" },
  { key: "vendors", label: "Vendors", group: "Delivery" },
  { key: "purchase", label: "Purchase", group: "Delivery" },
  { key: "ppr", label: "PPR", group: "Delivery" },
  { key: "payments", label: "Payments", group: "Finance" },
  { key: "invoices", label: "Invoices", group: "Finance" },
  { key: "finance", label: "Finance", group: "Finance" },
  { key: "employees", label: "Employees", group: "People" },
  { key: "hr", label: "HR", group: "People" },
  { key: "users", label: "Users", group: "People" },
  { key: "reports", label: "Reports", group: "Other" },
  { key: "settings", label: "Settings", group: "Other" },
  { key: "attendance", label: "Attendance", group: "People" }, // a person's own check in / out, movements and monthly calendar
] as const satisfies readonly ModuleDef[];

export type ModuleKey = (typeof MODULES)[number]["key"];

export const MODULE_KEYS = MODULES.map(m => m.key) as ModuleKey[];

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as string[]).includes(value);
}

export function isAction(value: string): value is Action {
  return (ACTIONS as readonly string[]).includes(value);
}

export function permissionKey(module: string, action: string) {
  return `${module}.${action}`.toLowerCase();
}

export const CRM_MODULES: ModuleKey[] = ["leads", "requirements", "quotes", "site_visits", "deals"];

// Route prefix → modules. Viewing the route needs `view` on ANY listed module.
// Longest prefix wins; routes not listed only require a signed-in user.
export const ROUTE_MODULES: { prefix: string; modules: ModuleKey[] }[] = [
  { prefix: "/users", modules: ["users"] },
  { prefix: "/admin/access", modules: ["users"] }, // Legacy Audit Log only
  { prefix: "/leads", modules: ["leads"] },
  { prefix: "/deals", modules: ["deals"] },
  { prefix: "/quotes", modules: ["quotes"] },
  { prefix: "/items", modules: ["quotes"] },
  { prefix: "/material-vendors", modules: ["vendors"] },
  { prefix: "/service-vendors", modules: ["vendors"] },
  { prefix: "/pre-payments", modules: ["ppr"] },
  { prefix: "/payment-collections", modules: ["payments"] },
  { prefix: "/attendance", modules: ["attendance"] },
  { prefix: "/projects", modules: ["projects", "boq"] },
  { prefix: "/tasks", modules: ["tasks"] },
  { prefix: "/team", modules: ["employees"] },
];

export function modulesForPath(pathname: string): ModuleKey[] | null {
  if (pathname === "/") return ["dashboard"];
  let best: { prefix: string; modules: ModuleKey[] } | null = null;
  for (const entry of ROUTE_MODULES) {
    if ((pathname === entry.prefix || pathname.startsWith(entry.prefix + "/")) &&
        (!best || entry.prefix.length > best.prefix.length)) {
      best = entry;
    }
  }
  return best ? best.modules : null;
}

// Sidebar order; an item shows when the user can view any of its modules.
export const NAV_ITEMS: { label: string; href: string; modules: ModuleKey[] }[] = [
  { label: "HOME", href: "/", modules: ["dashboard"] },
  { label: "LEADS", href: "/leads", modules: ["leads"] },
  { label: "DEALS", href: "/deals", modules: ["deals"] },
  { label: "QUOTES", href: "/quotes", modules: ["quotes"] },
  { label: "ITEMS", href: "/items", modules: ["quotes"] },
  { label: "MATERIAL VENDOR", href: "/material-vendors", modules: ["vendors"] },
  { label: "SERVICE VENDOR", href: "/service-vendors", modules: ["vendors"] },
  { label: "PRE-PAYMENT RECORDS", href: "/pre-payments", modules: ["ppr"] },
  { label: "PAYMENT COLLECTION RECORDS", href: "/payment-collections", modules: ["payments"] },
  { label: "ATTENDANCE", href: "/attendance", modules: ["attendance"] },
  { label: "TASKS", href: "/tasks", modules: ["tasks"] },
  { label: "PROJECTS", href: "/projects", modules: ["projects", "boq"] },
  { label: "TEAM", href: "/team", modules: ["employees"] },
  { label: "USERS", href: "/users", modules: ["users"] },
];

// Sentinel stored in the session snapshot for Super Admins / Full Administrators
export const ALL_PERMISSIONS = "*";

export function snapshotAllows(snapshot: readonly string[] | undefined, module: string, action: string = "view") {
  if (!snapshot) return false;
  return snapshot.includes(ALL_PERMISSIONS) || snapshot.includes(permissionKey(module, action));
}

export function snapshotCanViewAny(snapshot: readonly string[] | undefined, modules: readonly string[]) {
  return modules.some(m => snapshotAllows(snapshot, m, "view"));
}

// First page a user may open after signing in
export function landingPath(snapshot: readonly string[] | undefined) {
  const item = NAV_ITEMS.find(i => snapshotCanViewAny(snapshot, i.modules));
  return item ? item.href : "/unauthorized";
}

// ---------------------------------------------------------------------------
// Legacy permission translation (old "CRM.VIEW"-style rows → catalog keys)
// ---------------------------------------------------------------------------
export const LEGACY_MODULE_MAP: Record<string, ModuleKey[]> = {
  CRM: CRM_MODULES,
  Projects: ["projects", "boq", "vendors", "purchase", "ppr"],
  Tasks: ["tasks"],
  Team: ["employees", "hr"],
  Finance: ["finance", "payments", "invoices"],
  Reports: ["reports"],
  Settings: ["settings"],
};

export const LEGACY_ACTION_MAP: Record<string, Action[]> = {
  VIEW: ["view"],
  CREATE: ["create"],
  EDIT: ["edit"],
  DELETE: ["delete"],
  APPROVE: ["approve"],
  EXPORT: ["export"],
  ASSIGN: ["edit"],
  UPLOAD: ["create"],
  DOWNLOAD: ["export"],
  SHARE: ["view"],
  MANAGE: [...ACTIONS],
};
