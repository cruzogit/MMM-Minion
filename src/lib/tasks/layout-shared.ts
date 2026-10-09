// The Tasks "Edit Page Layout": which fields the Add Task form has (and in which order), which task types and which task statuses
// the page offers. Pure data and pure functions (no database), so the editor, the page and the API all share them.

export const CUSTOM_FIELD_TYPES = ["text", "number", "date", "dropdown"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type FormFieldDef = {
  key: string; // a built-in key (type, title, ...) or cf_xxxx for a field added in the editor
  label: string;
  custom: boolean;
  type?: CustomFieldType; // custom fields only
  options?: string[]; // dropdown fields only
  required: boolean;
  hidden: boolean; // built-in fields are hidden instead of deleted
};
export type TypeDef = {
  id: string; // task, lead, project, deal, office or ct_xxxx
  label: string;
  builtin: boolean;
  hidden: boolean; // not offered as a filter on the Tasks page
  creatable: boolean; // offered in the Task Type dropdown of the Add Task form
};
export type StatusDef = {
  id: string; // ongoing, started, incomplete, upcoming, assigned, completed or cs_xxxx
  label: string;
  builtin: boolean;
  hidden: boolean; // not shown as a tab on the Tasks page
};
export type TaskLayout = { fields: FormFieldDef[]; types: TypeDef[]; statuses: StatusDef[] };

export const BUILTIN_FIELD_META = {
  type: { label: "Task Type", canHide: false, canRequire: false, defaultHidden: false },
  assignedBy: { label: "Assigned By", canHide: true, canRequire: false, defaultHidden: false },
  title: { label: "Task Name", canHide: false, canRequire: false, defaultHidden: false },
  assignee: { label: "Assigned Person", canHide: true, canRequire: false, defaultHidden: false },
  start: { label: "Start Date", canHide: true, canRequire: true, defaultHidden: false },
  due: { label: "Due Date", canHide: true, canRequire: true, defaultHidden: false },
  priority: { label: "Priority", canHide: true, canRequire: false, defaultHidden: false },
  proof: { label: "Needs a proof file before it can be completed", canHide: true, canRequire: false, defaultHidden: false },
  notes: { label: "Notes", canHide: true, canRequire: true, defaultHidden: false },
  status: { label: "Status", canHide: true, canRequire: false, defaultHidden: true },
} as const;
export type BuiltinFieldKey = keyof typeof BUILTIN_FIELD_META;
export const BUILTIN_FIELD_KEYS = Object.keys(BUILTIN_FIELD_META) as BuiltinFieldKey[];
export const isBuiltinFieldKey = (k: string): k is BuiltinFieldKey => k in BUILTIN_FIELD_META;

// Always true for the title: the Add Task form cannot work without a Task Name
export const fieldRequiredLocked = (key: string) => key === "title";

const DEFAULT_TYPES: TypeDef[] = [
  { id: "task", label: "Task", builtin: true, hidden: false, creatable: false },
  { id: "lead", label: "Lead Task", builtin: true, hidden: false, creatable: false },
  { id: "project", label: "Project Task", builtin: true, hidden: false, creatable: true },
  { id: "deal", label: "Deal Task", builtin: true, hidden: false, creatable: false },
  { id: "office", label: "Office Task", builtin: true, hidden: false, creatable: true },
];
const DEFAULT_STATUSES: StatusDef[] = [
  { id: "ongoing", label: "Ongoing Task", builtin: true, hidden: false },
  { id: "started", label: "Started Task", builtin: true, hidden: false },
  { id: "incomplete", label: "Incomplete Task", builtin: true, hidden: false },
  { id: "upcoming", label: "Upcoming Task", builtin: true, hidden: false },
  { id: "assigned", label: "Assigned Task", builtin: true, hidden: false },
  { id: "completed", label: "Completed Task", builtin: true, hidden: false },
];
const DEFAULT_FIELD_ORDER: BuiltinFieldKey[] = ["type", "assignedBy", "title", "assignee", "start", "due", "priority", "proof", "notes", "status"];

// The status words the CRM already uses on a task; a custom status may not reuse one
export const RESERVED_STATUS_LABELS = ["Not Started", "Assigned", "In Progress", "Blocked", "Waiting", "Completed", "Verified", "Closed"];

export const MAX_CUSTOM_FIELDS = 30;
export const MAX_CUSTOM_TYPES = 20;
export const MAX_CUSTOM_STATUSES = 20;
export const MAX_LABEL = 60;

export function defaultTaskLayout(): TaskLayout {
  return {
    fields: DEFAULT_FIELD_ORDER.map(k => builtinField(k)),
    types: DEFAULT_TYPES.map(t => ({ ...t })),
    statuses: DEFAULT_STATUSES.map(s => ({ ...s })),
  };
}

function builtinField(key: BuiltinFieldKey): FormFieldDef {
  const m = BUILTIN_FIELD_META[key];
  return { key, label: m.label, custom: false, required: fieldRequiredLocked(key), hidden: m.defaultHidden };
}

export const newId = (prefix: "cf" | "ct" | "cs") => `${prefix}_${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
const ID_PATTERN = { cf: /^cf_[a-z0-9]{4,24}$/, ct: /^ct_[a-z0-9]{4,24}$/, cs: /^cs_[a-z0-9]{4,24}$/ };

const clean = (v: unknown, max = MAX_LABEL) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, max) : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Turns whatever was stored (or sent by the editor) into a valid layout. `errors` says what was wrong: the editor's save
// stops at the first one; reading the stored layout ignores them and simply drops what is invalid.
export function sanitizeTaskLayout(raw: unknown): { layout: TaskLayout; errors: string[] } {
  const input = rec(raw);
  const errors: string[] = [];
  const names = new Set<string>();
  const taken = (label: string, scope: string) => {
    const k = `${scope}:${label.toLowerCase()}`;
    if (names.has(k)) return true;
    names.add(k);
    return false;
  };

  // ---- Form fields
  const fields: FormFieldDef[] = [];
  const seen = new Set<string>();
  let customCount = 0;
  for (const item of list(input.fields)) {
    const f = rec(item);
    const key = typeof f.key === "string" ? f.key : "";
    if (seen.has(key)) continue;
    if (isBuiltinFieldKey(key) && f.custom !== true) {
      const meta = BUILTIN_FIELD_META[key];
      const label = clean(f.label) || meta.label;
      if (taken(label, "field")) { errors.push(`Two fields are named "${label}"`); continue; }
      seen.add(key);
      fields.push({
        key, label, custom: false,
        required: fieldRequiredLocked(key) || (meta.canRequire && f.required === true),
        hidden: meta.canHide && f.hidden === true,
      });
    } else if (ID_PATTERN.cf.test(key) && f.custom === true) {
      const label = clean(f.label);
      if (!label) { errors.push("Every field needs a name"); continue; }
      if (taken(label, "field")) { errors.push(`Two fields are named "${label}"`); continue; }
      const type = (CUSTOM_FIELD_TYPES as readonly string[]).includes(f.type as string) ? (f.type as CustomFieldType) : "text";
      let options: string[] | undefined;
      if (type === "dropdown") {
        options = [...new Set(list(f.options).map(o => clean(o)).filter(Boolean))].slice(0, 50);
        if (!options.length) { errors.push(`"${label}" is a dropdown: add at least one option`); continue; }
      }
      if (++customCount > MAX_CUSTOM_FIELDS) { errors.push(`At most ${MAX_CUSTOM_FIELDS} extra fields`); continue; }
      seen.add(key);
      fields.push({ key, label, custom: true, type, ...(options ? { options } : {}), required: f.required === true, hidden: false });
    }
  }
  for (const k of DEFAULT_FIELD_ORDER) if (!seen.has(k)) fields.push(builtinField(k));

  // ---- Task types
  const types = sanitizeNamed(list(input.types), DEFAULT_TYPES, "ct", MAX_CUSTOM_TYPES, "type", errors, names) as TypeDef[];
  for (const t of types) {
    const given = list(input.types).map(rec).find(x => x.id === t.id);
    t.creatable = given ? given.creatable === true : DEFAULT_TYPES.find(d => d.id === t.id)?.creatable ?? true;
  }
  if (!types.some(t => !t.hidden)) { errors.push("Keep at least one task type shown on the page"); types.forEach(t => (t.hidden = false)); }
  if (!types.some(t => t.creatable)) { errors.push("Keep at least one task type available in the Add Task form"); types.filter(t => t.id === "office" || t.id === "project").forEach(t => (t.creatable = true)); }

  // ---- Task statuses (the tabs of the page)
  const statuses = sanitizeNamed(list(input.statuses), DEFAULT_STATUSES, "cs", MAX_CUSTOM_STATUSES, "status", errors, names) as StatusDef[];
  for (const s of statuses) {
    if (!s.builtin && RESERVED_STATUS_LABELS.some(r => r.toLowerCase() === s.label.toLowerCase())) errors.push(`"${s.label}" is already a status the CRM uses`);
  }
  if (!statuses.some(s => !s.hidden)) { errors.push("Keep at least one task status shown on the page"); statuses.forEach(s => (s.hidden = false)); }

  return { layout: { fields, types, statuses }, errors };
}

// Types and statuses have the same shape of rules: built-ins keep their ids (and can only be renamed, hidden and moved), custom ones come and go
function sanitizeNamed(
  given: unknown[], defaults: { id: string; label: string; builtin: boolean; hidden: boolean }[], prefix: "ct" | "cs", maxCustom: number,
  what: string, errors: string[], names: Set<string>,
) {
  const out: { id: string; label: string; builtin: boolean; hidden: boolean }[] = [];
  const seen = new Set<string>();
  let customCount = 0;
  for (const item of given) {
    const x = rec(item);
    const id = typeof x.id === "string" ? x.id : "";
    if (seen.has(id)) continue;
    const base = defaults.find(d => d.id === id);
    const isCustom = !base && ID_PATTERN[prefix].test(id);
    if (!base && !isCustom) continue;
    const label = clean(x.label) || base?.label || "";
    if (!label) { errors.push(`Every task ${what} needs a name`); continue; }
    const k = `${what}:${label.toLowerCase()}`;
    if (names.has(k)) { errors.push(`Two task ${what}s are named "${label}"`); continue; }
    names.add(k);
    if (isCustom && ++customCount > maxCustom) { errors.push(`At most ${maxCustom} extra task ${what}s`); continue; }
    seen.add(id);
    out.push({ id, label, builtin: !!base, hidden: x.hidden === true });
  }
  for (const d of defaults) if (!seen.has(d.id)) out.push({ ...d });
  return out;
}

export const typeLabelOf = (layout: TaskLayout, id: string) => layout.types.find(t => t.id === id)?.label ?? "Task";
