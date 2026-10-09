// The Tasks module's rules in one place: task types, the six views, who may see what, search, sorting and the wording of
// "time left". Pure functions (no database, no server-only imports) so the page, the API and the tests all share them.
import type { Prisma } from "@prisma/client";
import type { TaskLayout } from "./layout-shared";

// ---------------------------------------------------------------------------
// Task type (stored in Task.taskType) and the six status views
// ---------------------------------------------------------------------------
export const TASK_TYPES = [
  { id: "task", label: "Task" },
  { id: "lead", label: "Lead Task" },
  { id: "project", label: "Project Task" },
  { id: "deal", label: "Deal Task" },
  { id: "office", label: "Office Task" },
] as const;
// The built-in type ids are task | lead | project | deal | office; types added in Edit Page Layout are ct_xxxx
export type TaskTypeId = string;

export const TASK_VIEWS = [
  { id: "ongoing", label: "Ongoing Task", empty: "No ongoing tasks" },
  { id: "started", label: "Started Task", empty: "No started tasks" },
  { id: "incomplete", label: "Incomplete Task", empty: "No incomplete tasks" },
  { id: "upcoming", label: "Upcoming Task", empty: "No upcoming tasks" },
  { id: "assigned", label: "Assigned Task", empty: "No assigned tasks" },
  { id: "completed", label: "Completed Task", empty: "No completed tasks" },
] as const;
// The built-in tab ids are the six above; statuses added in Edit Page Layout are cs_xxxx
export type TaskViewId = string;

// The CRM's own task statuses (comment on Task.status in schema.prisma). Nothing new is invented.
export const TASK_STATUSES = ["Not Started", "Assigned", "In Progress", "Blocked", "Waiting", "Completed", "Verified", "Closed"] as const;
export const COMPLETED_STATUSES: string[] = ["Completed", "Verified", "Closed"];
export const STARTED_STATUS = "In Progress";
export const isCompletedStatus = (status: string) => COMPLETED_STATUSES.includes(status);

export const TASK_PAGE_SIZE = 50;
export const TASK_SORTS = ["assigned", "start", "due"] as const;
export type TaskSortKey = (typeof TASK_SORTS)[number];
export const TASK_DATE_FIELDS = [
  { id: "start", label: "Start Date" },
  { id: "due", label: "Due Date" },
  { id: "assigned", label: "Assigned Date" },
] as const;
export type TaskDateField = (typeof TASK_DATE_FIELDS)[number]["id"];

export const isTaskType = (v: unknown, layout?: TaskLayout): v is TaskTypeId => (layout ? layout.types : TASK_TYPES).some(t => t.id === v);
export const isTaskView = (v: unknown, layout?: TaskLayout): v is TaskViewId => (layout ? layout.statuses : TASK_VIEWS).some(t => t.id === v);

// ---------------------------------------------------------------------------
// URL parameters of the page (?type=lead&view=ongoing&q=water&sort=due&dir=asc&page=2&dateField=due&from=2026-10-01&to=2026-10-31)
// ---------------------------------------------------------------------------
export type TaskListParams = {
  type: TaskTypeId;
  view: TaskViewId;
  q?: string;
  sort?: TaskSortKey;
  dir: "asc" | "desc";
  page: number;
  dateField?: TaskDateField;
  from?: string; // YYYY-MM-DD, in the CRM time zone
  to?: string;
};

export function parseTaskParams(raw: Record<string, string | string[] | undefined>, layout?: TaskLayout): TaskListParams {
  const one = (k: string) => (Array.isArray(raw[k]) ? (raw[k] as string[])[0] : (raw[k] as string | undefined));
  const day = (k: string) => {
    const v = one(k);
    return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
  };
  const type = one("type");
  const view = one("view");
  const sort = one("sort");
  const dateField = one("dateField");
  return {
    type: isTaskType(type, layout) ? type : layout?.types.find(t => !t.hidden)?.id ?? "task",
    view: isTaskView(view, layout) ? view : layout?.statuses.find(s => !s.hidden)?.id ?? "ongoing",
    q: one("q")?.trim().slice(0, 100) || undefined,
    sort: (TASK_SORTS as readonly string[]).includes(sort ?? "") ? (sort as TaskSortKey) : undefined,
    dir: one("dir") === "asc" ? "asc" : "desc",
    page: Math.max(1, Number(one("page")) || 1),
    dateField: TASK_DATE_FIELDS.some(f => f.id === dateField) ? (dateField as TaskDateField) : undefined,
    from: day("from"),
    to: day("to"),
  };
}

// ---------------------------------------------------------------------------
// Who may see which tasks. Always applied on the server, whatever the screen shows.
//   Administrators (isAdmin / isSuperAdmin): every task
//   Everyone else: tasks where they (or, for a manager, anyone reporting to them, directly or not) are the task person or the
//   person who assigned it. A normal employee has no reports, so that is just their own tasks, as in the legacy page.
// ---------------------------------------------------------------------------
export type TaskScope = { all: boolean; me: string | null; people: string[] };

export function taskVisibility(scope: TaskScope): Prisma.TaskWhereInput {
  if (scope.all) return {};
  if (!scope.people.length) return { id: "__no_access__" };
  return { OR: [{ assigneeId: { in: scope.people } }, { assignedByEmployeeId: { in: scope.people } }] };
}

// Ongoing / Started / Incomplete are about the task person's own work: for a manager that is their team's work
const ownerSide = (scope: TaskScope): Prisma.TaskWhereInput => (scope.all ? {} : { assigneeId: { in: scope.people } });

// The six views, from the legacy page's categorization, on top of the person scope
// `custom` maps the id of a status added in Edit Page Layout to its label: such a tab lists the tasks that were given that status
function viewClause(view: TaskViewId, scope: TaskScope, now: Date, custom?: Map<string, string>): Prisma.TaskWhereInput {
  const active: Prisma.TaskWhereInput = { status: { notIn: COMPLETED_STATUSES } };
  switch (view) {
    case "completed":
      return { status: { in: COMPLETED_STATUSES } };
    case "ongoing": // not finished, and its start date has arrived. Overdue tasks stay here too, as in the legacy page.
      return { AND: [active, ownerSide(scope), { OR: [{ startDate: null }, { startDate: { lte: now } }] }] };
    case "started": // really started: status In Progress, not merely "has a start date"
      return { AND: [active, ownerSide(scope), { status: STARTED_STATUS }] };
    case "incomplete": // overdue: not finished and the due date and time has passed
      return { AND: [active, ownerSide(scope), { dueDate: { lt: now } }] };
    case "upcoming": // not finished, and its start date is still in the future
      return { AND: [active, { startDate: { gt: now } }] };
    case "assigned": // tasks I gave to someone, whatever their status
      return scope.me ? { assignedByEmployeeId: scope.me } : { id: "__no_access__" };
    default: {
      const label = custom?.get(view);
      return label ? { status: label } : { id: "__no_access__" };
    }
  }
}

function searchClause(q: string): Prisma.TaskWhereInput {
  const has = { contains: q, mode: "insensitive" as const };
  return {
    OR: [
      { title: has },
      { notes: has },
      { description: has },
      { productId: has },
      { lead: { is: { leadCode: has } } },
      { lead: { is: { customerName: has } } },
      { lead: { is: { contactNumber: has } } },
      { customer: { is: { name: has } } },
      { customer: { is: { customerCode: has } } },
      { deal: { is: { dealNumber: has } } },
      { deal: { is: { title: has } } },
      { project: { is: { name: has } } },
      { assignee: { is: { user: { is: { name: has } } } } },
      { assignedBy: { is: { user: { is: { name: has } } } } },
    ],
  };
}

export type TaskDateRange = { field: TaskDateField; from?: Date; to?: Date };

const DATE_COLUMN = { start: "startDate", due: "dueDate", assigned: "assignedAt" } as const;

export function buildTaskWhere(params: Pick<TaskListParams, "type" | "view" | "q">, scope: TaskScope, now: Date, range?: TaskDateRange, custom?: Map<string, string>): Prisma.TaskWhereInput {
  const AND: Prisma.TaskWhereInput[] = [taskVisibility(scope), { taskType: params.type }, viewClause(params.view, scope, now, custom)];
  if (params.q) AND.push(searchClause(params.q));
  if (range && (range.from || range.to)) {
    AND.push({ [DATE_COLUMN[range.field]]: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lt: range.to } : {}) } });
  }
  return { AND };
}

// Same filters for the six counts, whatever view is open
export function buildViewCountWhere(view: TaskViewId, params: Pick<TaskListParams, "type" | "q">, scope: TaskScope, now: Date, range?: TaskDateRange, custom?: Map<string, string>) {
  return buildTaskWhere({ type: params.type, view, q: params.q }, scope, now, range, custom);
}

// Default order follows the legacy page: newest start first; most overdue first for Incomplete; latest completion first for Completed
export function taskOrderBy(view: TaskViewId, sort: TaskSortKey | undefined, dir: "asc" | "desc"): Prisma.TaskOrderByWithRelationInput[] {
  const tie: Prisma.TaskOrderByWithRelationInput = { id: "desc" };
  if (sort === "assigned") return [{ assignedAt: dir }, tie];
  if (sort === "start") return [{ startDate: { sort: dir, nulls: "last" } }, tie];
  if (sort === "due") return [{ dueDate: { sort: dir, nulls: "last" } }, tie];
  if (view === "incomplete") return [{ dueDate: { sort: "asc", nulls: "last" } }, tie];
  if (view === "completed") return [{ completedAt: { sort: "desc", nulls: "last" } }, tie];
  return [{ startDate: { sort: "desc", nulls: "last" } }, tie];
}

// ---------------------------------------------------------------------------
// Wording, ported from the legacy page so the Task Due D&T and Status columns read the same
// ---------------------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? "s" : ""}`;

// "-7 months 23 days", "-3 hrs", "Due now", "45 mins left", "2 days left.."
export function remainingText(due: Date | null, completed: boolean, now: Date, today: [Date, Date]): string {
  if (completed) return "Completed";
  if (!due || Number.isNaN(due.getTime())) return "Not Set";
  const diff = due.getTime() - now.getTime();

  if (diff < 0) {
    const hoursOver = Math.abs(Math.floor(diff / HOUR));
    const daysOver = Math.abs(Math.floor(diff / DAY));
    if (daysOver >= 365) {
      const years = Math.floor(daysOver / 365);
      const months = Math.floor((daysOver % 365) / 30);
      return months > 0 ? `-${plural(years, "year")} ${plural(months, "month")}` : `-${plural(years, "year")}`;
    }
    if (daysOver >= 30) {
      const months = Math.floor(daysOver / 30);
      const days = daysOver % 30;
      return days > 0 ? `-${plural(months, "month")} ${plural(days, "day")}` : `-${plural(months, "month")}`;
    }
    if (hoursOver >= 24) return `-${plural(daysOver, "day")}`;
    return `-${plural(hoursOver, "hr")}`;
  }

  if (due >= today[0] && due < today[1]) {
    const totalMinutes = Math.floor(diff / MIN);
    if (totalMinutes < 5) return "Due now";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes} mins left`;
    const hourText = hours === 1 ? "hour" : "hours";
    return minutes === 0 ? `${hours} ${hourText} left` : `${hours} ${hourText} ${minutes} mins left`;
  }

  const days = Math.floor(diff / DAY);
  const hours = Math.floor((diff % DAY) / HOUR);
  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months} Month${months > 1 ? "s" : ""} ${days % 30} days left..`;
  }
  if (days > 0) return `${days} days left..`;
  if (hours > 0) return `${hours} hrs left..`;
  return "Due now";
}

// "5 mins ago..", "3 hrs ago..", "12 days ago.." (the small badge under the status)
export function timeAgo(date: Date | null, now: Date): string {
  if (!date) return "";
  const mins = Math.floor((now.getTime() - date.getTime()) / MIN);
  if (mins < 0) return "";
  if (mins < 60) return `${mins} mins ago..`;
  if (mins < 1440) {
    const hours = Math.floor(mins / 60);
    return `${hours} ${hours === 1 ? "hr" : "hrs"} ago..`;
  }
  return `${Math.floor(mins / 1440)} days ago..`;
}
