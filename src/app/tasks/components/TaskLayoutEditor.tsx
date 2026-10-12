'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, GripVertical, LayoutTemplate, Loader2, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import {
  BUILTIN_FIELD_META, CUSTOM_FIELD_TYPES, MAX_CUSTOM_FIELDS, MAX_CUSTOM_STATUSES, MAX_CUSTOM_TYPES, MAX_LABEL, defaultTaskLayout, fieldRequiredLocked, isBuiltinFieldKey, newId,
  type CustomFieldType, type FormFieldDef, type StatusDef, type TaskLayout, type TypeDef,
} from '@/lib/tasks/layout-shared';

type Tab = 'form' | 'types' | 'status';

// What a sortable row gets to attach to its own elements (the handle's listeners, the node, the moving style)
type Dnd = Pick<ReturnType<typeof useSortable>, 'setNodeRef' | 'listeners' | 'attributes'> & { style: CSSProperties };

const TABS: { id: Tab; label: string }[] = [
  { id: 'form', label: 'Add Task Form' },
  { id: 'types', label: 'Task Type' },
  { id: 'status', label: 'Task Status' },
];
const TYPE_NAME: Record<CustomFieldType, string> = { text: 'Text', number: 'Number', date: 'Date', dropdown: 'Dropdown' };

const box = 'border border-gray-300 rounded px-2.5 h-[34px] text-[13px] text-gray-900 bg-white focus:outline-none focus:border-[#f5b800] disabled:bg-gray-100';
const iconBtn = 'w-8 h-8 inline-flex items-center justify-center rounded text-gray-600 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent';

const patched = <T,>(items: T[], i: number, change: Partial<T>): T[] => items.map((x, k) => (k === i ? { ...x, ...change } : x));

// The "Edit Page Layout" button of the Tasks page and its window
export function TaskLayoutButton({ layout }: { layout: TaskLayout }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Edit Page Layout" aria-label="Edit Page Layout"
        className="inline-flex items-center gap-2 px-3 h-[42px] rounded border-2 border-gray-200 hover:border-gray-400 bg-white text-[13px] font-medium text-gray-800 whitespace-nowrap">
        <LayoutTemplate className="w-4 h-4" /> Edit Page Layout
      </button>
      {open && <TaskLayoutEditor initial={layout} onClose={changed => { setOpen(false); if (changed) router.refresh(); }} />}
    </>
  );
}

function TaskLayoutEditor({ initial, onClose }: { initial: TaskLayout; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('form');
  const [draft, setDraft] = useState<TaskLayout>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose(false);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, saving]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await callApi('/api/tasks/layout', 'PUT', draft);
      toast.success('Page layout saved');
      onClose(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the layout');
      setSaving(false);
    }
  };

  const reset = () => {
    const d = defaultTaskLayout();
    setDraft(tab === 'form' ? { ...draft, fields: d.fields } : tab === 'types' ? { ...draft, types: d.types } : { ...draft, statuses: d.statuses });
    setError('');
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="task-layout-title" className="bg-white w-full sm:max-w-[820px] max-h-screen sm:max-h-[92vh] sm:rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-200 shrink-0">
          <div>
            <h2 id="task-layout-title" className="text-[19px] font-bold text-[#444]">Edit Page Layout</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">Changes apply to everyone once you press Save.</p>
          </div>
          <button type="button" onClick={() => onClose(false)} disabled={saving} aria-label="Close" className="text-gray-500 hover:text-black disabled:opacity-40"><X className="w-6 h-6" /></button>
        </div>

        <div role="tablist" className="flex gap-1 px-6 pt-3 border-b border-gray-200 shrink-0 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`px-4 h-[38px] text-[13px] font-semibold whitespace-nowrap border-b-2 -mb-px ${tab === t.id ? 'border-[#f5b800] text-[#1f1f1f]' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>{t.label}</button>
          ))}
        </div>

        <div className="overflow-y-auto px-6 py-5 flex-1">
          {tab === 'form' && <FormTab fields={draft.fields} onChange={fields => setDraft({ ...draft, fields })} />}
          {tab === 'types' && <TypesTab types={draft.types} onChange={types => setDraft({ ...draft, types })} />}
          {tab === 'status' && <StatusTab statuses={draft.statuses} onChange={statuses => setDraft({ ...draft, statuses })} />}
        </div>

        {error && <p role="alert" className="px-6 pb-2 text-[13px] text-[#d9232b]">{error}</p>}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 shrink-0">
          <button type="button" onClick={reset} disabled={saving} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-600 hover:text-black disabled:opacity-50">
            <RotateCcw className="w-4 h-4" /> Reset this tab
          </button>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => onClose(false)} disabled={saving} className="px-5 h-[40px] rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-[14px] font-medium disabled:opacity-60">Cancel</button>
            <button type="button" onClick={save} disabled={saving} className="inline-flex items-center gap-2 px-5 h-[40px] rounded-lg bg-[#f5b800] hover:bg-[#e0a800] text-[#1f1f1f] text-[14px] font-semibold disabled:opacity-60">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


function DragHandle(props: React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-label="Drag to reorder" title="Drag to reorder" className="cursor-grab hover:text-black text-gray-400 shrink-0 h-4 w-6 inline-flex items-center justify-center" {...props}>
      <GripVertical className="w-4 h-4" />
    </button>
  );
}

function SortableItem({ id, children }: { id: string; children: (args: Dnd) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 50, opacity: 0.5, position: 'relative' as const } : {})
  };
  return <>{children({ setNodeRef, style, listeners, attributes })}</>;
}

function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  className
}: {
  items: T[];
  getId: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T, index: number, dnd: Dnd) => React.ReactNode;
  className?: string;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = items.findIndex(i => getId(i) === active.id);
      const newIndex = items.findIndex(i => getId(i) === over.id);
      onReorder(arrayMove(items, oldIndex, newIndex));
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(getId)} strategy={verticalListSortingStrategy}>
        <ul className={className}>
          {items.map((item, index) => (
            <SortableItem key={getId(item)} id={getId(item)}>
              {dnd => renderItem(item, index, dnd)}
            </SortableItem>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

const Badge = ({ children, tone = 'gray' }: { children: React.ReactNode; tone?: 'gray' | 'amber' }) => (
  <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${tone === 'amber' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{children}</span>
);

// ---------------------------------------------------------------------------
// Add Task Form: add, rename, require, hide, delete and reorder the fields
// ---------------------------------------------------------------------------
function FormTab({ fields, onChange }: { fields: FormFieldDef[]; onChange: (f: FormFieldDef[]) => void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [required, setRequired] = useState(false);
  const [problem, setProblem] = useState('');
  const customCount = fields.filter(f => f.custom).length;

  const add = () => {
    const name = label.trim().replace(/\s+/g, ' ');
    const options = [...new Set(optionsText.split('\n').map(o => o.trim()).filter(Boolean))];
    if (!name) return setProblem('Give the field a name');
    if (fields.some(f => f.label.toLowerCase() === name.toLowerCase())) return setProblem(`A field named "${name}" already exists`);
    if (type === 'dropdown' && !options.length) return setProblem('Add at least one option, one per line');
    if (customCount >= MAX_CUSTOM_FIELDS) return setProblem(`At most ${MAX_CUSTOM_FIELDS} extra fields`);
    onChange([...fields, { key: newId('cf'), label: name, custom: true, type, ...(type === 'dropdown' ? { options } : {}), required, hidden: false }]);
    setLabel(''); setOptionsText(''); setRequired(false); setType('text'); setProblem('');
  };

  return (
    <div>
      <p className="text-[12px] text-gray-500 mb-3">Rename fields, change their order, make them required, hide the ones you do not use, or add your own. Task Type and Task Name always stay in the form.</p>
      <SortableList
        items={fields}
        getId={f => f.key}
        onReorder={onChange}
        className="space-y-2"
        renderItem={(f, i, { setNodeRef, style, listeners, attributes }) => {
          const meta = isBuiltinFieldKey(f.key) ? BUILTIN_FIELD_META[f.key] : null;
          const canRequire = f.custom || !!meta?.canRequire;
          return (
            <li ref={setNodeRef} style={style} className={`border border-gray-200 rounded-lg px-3 py-2.5 ${f.hidden ? 'bg-gray-50' : 'bg-white'}`}>
              <div className="flex items-center gap-3 flex-wrap">
                <DragHandle {...listeners} {...attributes} />
                <input value={f.label} maxLength={MAX_LABEL} aria-label={`Name of ${f.label}`} onChange={e => onChange(patched(fields, i, { label: e.target.value }))}
                  className={`${box} flex-1 min-w-[180px] ${f.hidden ? 'text-gray-400' : ''}`} />
                {f.custom ? <Badge tone="amber">{TYPE_NAME[f.type ?? 'text']}</Badge> : <Badge>Built-in</Badge>}
                <label className={`inline-flex items-center gap-1.5 text-[12px] ${canRequire && !f.hidden ? 'text-gray-700 cursor-pointer' : 'text-gray-300'}`}>
                  <input type="checkbox" checked={f.required} disabled={!canRequire || f.hidden || fieldRequiredLocked(f.key)} onChange={e => onChange(patched(fields, i, { required: e.target.checked }))} className="accent-black" /> Required
                </label>
                {f.custom ? (
                  <button type="button" onClick={() => onChange(fields.filter((_, k) => k !== i))} aria-label={`Delete ${f.label}`} title="Delete field" className={`${iconBtn} hover:!text-[#d9232b]`}><Trash2 className="w-4 h-4" /></button>
                ) : (
                  <button type="button" disabled={!meta?.canHide} onClick={() => onChange(patched(fields, i, { hidden: !f.hidden, required: f.hidden ? f.required : false }))}
                    aria-label={f.hidden ? `Show ${f.label}` : `Hide ${f.label}`} title={meta?.canHide ? (f.hidden ? 'Show in the form' : 'Hide from the form') : 'Always in the form'} className={iconBtn}>
                    {f.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                )}
              </div>
              {f.custom && f.type === 'dropdown' && (
                <div className="mt-2 pl-11">
                  <label className="block text-[11px] font-semibold text-gray-500 mb-1">Options (one per line)</label>
                  <textarea rows={Math.min(6, Math.max(2, (f.options?.length ?? 0) + 1))} value={(f.options ?? []).join('\n')} aria-label={`Options of ${f.label}`}
                    onChange={e => onChange(patched(fields, i, { options: e.target.value.split('\n') }))} className={`${box} w-full h-auto py-1.5`} />
                </div>
              )}
            </li>
          );
        }}
      />

      <div className="mt-5 border border-dashed border-gray-300 rounded-lg p-4">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-gray-500 mb-3">Add field</div>
        <div className="flex flex-wrap items-center gap-3">
          <input value={label} maxLength={MAX_LABEL} onChange={e => { setLabel(e.target.value); setProblem(''); }} placeholder="Field name" aria-label="New field name" className={`${box} flex-1 min-w-[180px]`}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
          <select value={type} onChange={e => setType(e.target.value as CustomFieldType)} aria-label="New field type" className={`${box} cursor-pointer`}>
            {CUSTOM_FIELD_TYPES.map(t => <option key={t} value={t}>{TYPE_NAME[t]}</option>)}
          </select>
          <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-700 cursor-pointer"><input type="checkbox" checked={required} onChange={e => setRequired(e.target.checked)} className="accent-black" /> Required</label>
          <button type="button" onClick={add} className="inline-flex items-center gap-1.5 px-3 h-[34px] rounded bg-[#f5b800] hover:bg-[#e0a800] text-[#1f1f1f] text-[13px] font-semibold"><Plus className="w-4 h-4" /> Add</button>
        </div>
        {type === 'dropdown' && (
          <textarea rows={3} value={optionsText} onChange={e => { setOptionsText(e.target.value); setProblem(''); }} placeholder={'Options, one per line'} aria-label="New dropdown options" className={`${box} w-full h-auto py-1.5 mt-3`} />
        )}
        {problem && <p role="alert" className="text-[12px] text-[#d9232b] mt-2">{problem}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Type: the filters of the page and the Task Type dropdown of the Add Task form
// ---------------------------------------------------------------------------
function TypesTab({ types, onChange }: { types: TypeDef[]; onChange: (t: TypeDef[]) => void }) {
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState('');
  const customCount = types.filter(t => !t.builtin).length;

  const add = () => {
    const name = label.trim().replace(/\s+/g, ' ');
    if (!name) return setProblem('Give the task type a name');
    if (types.some(t => t.label.toLowerCase() === name.toLowerCase())) return setProblem(`A task type named "${name}" already exists`);
    if (customCount >= MAX_CUSTOM_TYPES) return setProblem(`At most ${MAX_CUSTOM_TYPES} extra task types`);
    onChange([...types, { id: newId('ct'), label: name, builtin: false, hidden: false, creatable: true }]);
    setLabel(''); setProblem('');
  };

  return (
    <div>
      <p className="text-[12px] text-gray-500 mb-3">
        <b>Show</b> puts the type in the filters of the Tasks page. <b>In Add Task</b> offers it in the Task Type dropdown when a task is created. Built-in types can be renamed, hidden and moved; types you add can also be deleted once no task uses them.
      </p>
      <SortableList
        items={types}
        getId={t => t.id}
        onReorder={onChange}
        className="space-y-2"
        renderItem={(t, i, { setNodeRef, style, listeners, attributes }) => (
          <li ref={setNodeRef} style={style} className={`border border-gray-200 rounded-lg px-3 py-2.5 flex items-center gap-3 flex-wrap ${t.hidden ? 'bg-gray-50' : 'bg-white'}`}>
            <DragHandle {...listeners} {...attributes} />
            <input value={t.label} maxLength={MAX_LABEL} aria-label={`Name of ${t.label}`} onChange={e => onChange(patched(types, i, { label: e.target.value }))} className={`${box} flex-1 min-w-[180px] ${t.hidden ? 'text-gray-400' : ''}`} />
            {t.builtin ? <Badge>Built-in</Badge> : <Badge tone="amber">Custom</Badge>}
            <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-700 cursor-pointer">
              <input type="checkbox" checked={t.creatable} onChange={e => onChange(patched(types, i, { creatable: e.target.checked }))} className="accent-black" /> In Add Task
            </label>
            <button type="button" onClick={() => onChange(patched(types, i, { hidden: !t.hidden }))} aria-label={t.hidden ? `Show ${t.label}` : `Hide ${t.label}`} title={t.hidden ? 'Show on the page' : 'Hide from the page'} className={iconBtn}>
              {t.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            {!t.builtin && <button type="button" onClick={() => onChange(types.filter((_, k) => k !== i))} aria-label={`Delete ${t.label}`} title="Delete task type" className={`${iconBtn} hover:!text-[#d9232b]`}><Trash2 className="w-4 h-4" /></button>}
          </li>
        )}
      />
      <AddRow value={label} onValue={v => { setLabel(v); setProblem(''); }} onAdd={add} placeholder="New task type" problem={problem} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task Status: the tabs of the Tasks page
// ---------------------------------------------------------------------------
function StatusTab({ statuses, onChange }: { statuses: StatusDef[]; onChange: (s: StatusDef[]) => void }) {
  const [label, setLabel] = useState('');
  const [problem, setProblem] = useState('');
  const customCount = statuses.filter(s => !s.builtin).length;

  const add = () => {
    const name = label.trim().replace(/\s+/g, ' ');
    if (!name) return setProblem('Give the task status a name');
    if (statuses.some(s => s.label.toLowerCase() === name.toLowerCase())) return setProblem(`A task status named "${name}" already exists`);
    if (customCount >= MAX_CUSTOM_STATUSES) return setProblem(`At most ${MAX_CUSTOM_STATUSES} extra task statuses`);
    onChange([...statuses, { id: newId('cs'), label: name, builtin: false, hidden: false }]);
    setLabel(''); setProblem('');
  };

  return (
    <div>
      <p className="text-[12px] text-gray-500 mb-3">
        These are the tabs of the Tasks page. The built-in ones are worked out automatically (for example, Incomplete is every overdue task), so they can be renamed, hidden and moved. A status you add lists the tasks given that status: set it with the <b>Status</b> field of the Add Task form (turn it on in the Add Task Form tab). Deleting a status you added moves its tasks back to Not Started.
      </p>
      <SortableList
        items={statuses}
        getId={s => s.id}
        onReorder={onChange}
        className="space-y-2"
        renderItem={(s, i, { setNodeRef, style, listeners, attributes }) => (
          <li ref={setNodeRef} style={style} className={`border border-gray-200 rounded-lg px-3 py-2.5 flex items-center gap-3 flex-wrap ${s.hidden ? 'bg-gray-50' : 'bg-white'}`}>
            <DragHandle {...listeners} {...attributes} />
            <input value={s.label} maxLength={MAX_LABEL} aria-label={`Name of ${s.label}`} onChange={e => onChange(patched(statuses, i, { label: e.target.value }))} className={`${box} flex-1 min-w-[180px] ${s.hidden ? 'text-gray-400' : ''}`} />
            {s.builtin ? <Badge>Automatic</Badge> : <Badge tone="amber">Custom</Badge>}
            <button type="button" onClick={() => onChange(patched(statuses, i, { hidden: !s.hidden }))} aria-label={s.hidden ? `Show ${s.label}` : `Hide ${s.label}`} title={s.hidden ? 'Show on the page' : 'Hide from the page'} className={iconBtn}>
              {s.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
            {!s.builtin && <button type="button" onClick={() => onChange(statuses.filter((_, k) => k !== i))} aria-label={`Delete ${s.label}`} title="Delete task status" className={`${iconBtn} hover:!text-[#d9232b]`}><Trash2 className="w-4 h-4" /></button>}
          </li>
        )}
      />
      <AddRow value={label} onValue={v => { setLabel(v); setProblem(''); }} onAdd={add} placeholder="New task status" problem={problem} />
    </div>
  );
}

function AddRow({ value, onValue, onAdd, placeholder, problem }: { value: string; onValue: (v: string) => void; onAdd: () => void; placeholder: string; problem: string }) {
  return (
    <div className="mt-5 border border-dashed border-gray-300 rounded-lg p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input value={value} maxLength={MAX_LABEL} onChange={e => onValue(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={`${box} flex-1 min-w-[180px]`}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }} />
        <button type="button" onClick={onAdd} className="inline-flex items-center gap-1.5 px-3 h-[34px] rounded bg-[#f5b800] hover:bg-[#e0a800] text-[#1f1f1f] text-[13px] font-semibold"><Plus className="w-4 h-4" /> Add</button>
      </div>
      {problem && <p role="alert" className="text-[12px] text-[#d9232b] mt-2">{problem}</p>}
    </div>
  );
}
