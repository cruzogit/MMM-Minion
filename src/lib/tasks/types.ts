// What the server sends the Tasks page. Plain data only, so the browser can use it too.
import type { TaskTypeId } from "./rules";
import type { TaskLayout } from "./layout-shared";

export type DateTimeText = { date: string; time: string };
export type Person = { id: string; name: string };

export type TaskRow = {
  id: string;
  taskType: TaskTypeId;
  typeLabel: string; // label of the task type as named in Edit Page Layout
  title: string;
  assigned: DateTimeText; // Assigned D&T
  start: DateTimeText | null; // Start Date
  due: DateTimeText | null; // Task Due D&T
  remaining: string; // "-7 months 23 days", "2 days left..", "Completed"
  completed: DateTimeText | null;
  assignee: Person | null; // task person
  assignedBy: Person | null; // task assigned person
  lead: { id: string; code: string } | null;
  notes: { customerName: string | null; contactNumber: string | null; requirement: string | null; text: string | null };
  status: string;
  statusAgo: string;
  productId: string | null;
  customerCode: string | null; // Order ID / Customer ID
  starred: boolean;
  filesCount: number;
  requiresCompletionProof: boolean;
  can: { start: boolean; complete: boolean; upload: boolean; star: boolean; edit: boolean; delete: boolean };
};

export type TaskFile = { id: string; name: string; mimeType: string | null; size: number | null; url: string | null; createdAt: string };

export type TaskDetail = TaskRow & {
  description: string | null;
  priority: string;
  startRaw: string | null; // yyyy-mm-dd / HH:mm in the CRM time zone, to fill the edit form
  startTimeRaw: string | null;
  dueRaw: string | null;
  dueTimeRaw: string | null;
  link: { kind: "lead" | "project" | "deal"; id: string; label: string } | null;
  customValues: Record<string, string | number | null>; // values of the Edit Page Layout fields, keyed by field key
  customFields: { key: string; label: string; value: string }[]; // the same, ready to show (only fields still in the layout)
  files: TaskFile[];
  history: { action: string; by: string; at: string }[];
};

export type TaskListResult = {
  rows: TaskRow[];
  total: number; // rows in the selected type + view (with search and date filter)
  counts: Record<string, number>;
  page: number;
  pageCount: number;
  pageSize: number;
};

export type TaskOptions = { employees: { id: string; name: string; designation: string | null }[]; layout: TaskLayout; canEditLayout: boolean };
export type LinkOption = { id: string; label: string };
