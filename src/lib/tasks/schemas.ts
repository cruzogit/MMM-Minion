import { z } from "zod";
import { AUDIO_FORMATS_LABEL, isAllowedAudioType } from "@/lib/leads/audio-types";
import { ATTACHMENT_BLOCKED_HINT, isAllowedImageType, isAttachmentAllowed, maxFileBytes, maxFileLabel } from "@/lib/leads/constants";

// .strict(): unknown fields are rejected, never silently applied.
const id = z.string().trim().min(1).max(64);
const optionalId = id.nullable().optional().transform(v => v || null);
const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).nullable().optional().transform(v => v || null);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time");
const optionalDay = day.nullable().optional().transform(v => v || null);
const optionalClock = clock.nullable().optional().transform(v => v || null);

// The built-in types are task | lead | project | deal | office; types added in Edit Page Layout are ct_xxxx. The service checks the id against the layout.
const typeId = z.string({ required_error: "Choose the task type" }).trim().min(1, "Choose the task type").max(64);
type TypeId = string;

// Values of the fields added in Edit Page Layout, keyed by field key; the service checks them against the layout
const customValues = z.record(z.string().max(64), z.union([z.string().max(2000), z.number(), z.null()])).optional();

const taskFields = {
  title: z.string({ required_error: "Task Name is required" }).trim().min(1, "Task Name is required").max(200),
  assigneeId: optionalId, // the task person; defaults to the person creating the task
  startDate: optionalDay,
  startTime: optionalClock,
  dueDate: optionalDay,
  dueTime: optionalClock,
  notes: optionalText(5000),
  productId: optionalText(100), // typed in: there is no Product table
  priority: z.enum(["Low", "Medium", "High"]).optional().default("Medium"),
  requiresCompletionProof: z.boolean().optional().default(true), // the legacy page only let a task be completed after a file was uploaded
  leadId: optionalId,
  projectId: optionalId,
  dealId: optionalId,
  customFields: customValues,
  statusLabel: optionalText(60), // a status added in Edit Page Layout (or Not Started); empty keeps the current status
};

// What each task type must (and must not) be linked to
function linkRules(v: { leadId: string | null; projectId: string | null; dealId: string | null }, type: TypeId, ctx: z.RefinementCtx) {
  const need: Record<string, string> = { lead: "leadId", project: "projectId", deal: "dealId" };
  const label = { leadId: "Lead", projectId: "Project", dealId: "Deal" } as const;
  for (const key of ["leadId", "projectId", "dealId"] as const) {
    const wanted = type !== "task" && type !== "office" && need[type] === key;
    if (wanted && !v[key]) ctx.addIssue({ code: "custom", path: [key], message: `Choose the ${label[key]} for this task` });
    if (!wanted && v[key]) ctx.addIssue({ code: "custom", path: [key], message: `A ${type === "task" ? "general" : type} task is not linked to a ${label[key].toLowerCase()}` });
  }
}

const dateOrder = (v: { startDate: string | null; startTime: string | null; dueDate: string | null; dueTime: string | null }, ctx: z.RefinementCtx) => {
  if (v.startTime && !v.startDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Choose a Start Date as well as a time" });
  if (v.dueTime && !v.dueDate) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "Choose a Due Date as well as a time" });
  if (v.startDate && v.dueDate) {
    const start = `${v.startDate}T${v.startTime ?? "09:00"}`;
    const due = `${v.dueDate}T${v.dueTime ?? "18:00"}`;
    if (due < start) ctx.addIssue({ code: "custom", path: ["dueDate"], message: "The due date and time cannot be before the start" });
  }
};

export const taskInputSchema = z
  .object({ taskType: typeId, ...taskFields })
  .strict()
  .superRefine((v, ctx) => {
    linkRules(v, v.taskType, ctx);
    dateOrder(v, ctx);
  });
export type TaskInput = z.infer<typeof taskInputSchema>;

// Editing keeps the stored task type, so the type is not accepted here
export const taskEditSchema = z.object(taskFields).strict();
export type TaskEditInput = z.infer<typeof taskEditSchema>;
export const checkEditAgainstType = (v: TaskEditInput, type: TypeId) => {
  const issues: { path: string; message: string }[] = [];
  const ctx = { addIssue: (i: { path: (string | number)[]; message: string }) => issues.push({ path: i.path.join("."), message: i.message }) } as unknown as z.RefinementCtx;
  linkRules(v, type, ctx);
  dateOrder(v, ctx);
  return issues;
};

// ---- Files (proof photos, documents, call recordings)
const fileShape = { name: z.string().trim().min(1).max(255), type: z.string().trim().max(150), size: z.number().int().positive() };
function fileChecks(f: { name: string; type: string; size: number }, ctx: z.RefinementCtx) {
  const bad = (message: string) => ctx.addIssue({ code: "custom", path: ["name"], message });
  if (!isAttachmentAllowed(f.name)) bad(`File type not allowed (${ATTACHMENT_BLOCKED_HINT})`);
  if (f.type.startsWith("image/") && !isAllowedImageType(f.type)) bad("Only JPEG, PNG and WebP images are supported");
  if (f.type.startsWith("audio/") && !isAllowedAudioType(f.type)) bad(`Unsupported audio format (${AUDIO_FORMATS_LABEL})`);
  if (f.size > maxFileBytes(f.type)) bad(`File is larger than ${maxFileLabel(f.type)}`);
}

export const MAX_TASK_FILES = 20;
export const taskFilesSignSchema = z.object({ files: z.array(z.object(fileShape).strict().superRefine(fileChecks)).min(1).max(10) }).strict();
export const taskFilesCompleteSchema = z
  .object({ files: z.array(z.object({ path: z.string().trim().min(1).max(400), ...fileShape }).strict().superRefine(fileChecks)).min(1).max(10) })
  .strict();

export const linkSearchSchema = z.object({ kind: z.enum(["lead", "project", "deal"]), q: z.string().trim().max(100).optional() });
