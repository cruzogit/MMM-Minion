'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import { ApiError, callApi } from '@/lib/leads/client';
import type { TaskTypeId } from '@/lib/tasks/rules';
import type { LinkOption, TaskDetail, TaskOptions } from '@/lib/tasks/types';

const input = 'w-full border-2 border-gray-200 rounded-md px-3 h-[40px] text-[14px] text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:border-[#f5b800] disabled:bg-gray-100';
const label = 'block text-[13px] font-semibold text-[#444] mb-1';
const err = 'text-[12px] text-[#d9232b] mt-1';

type Link = { id: string; label: string } | null;
const LINK_KIND = { lead: 'Lead', project: 'Project', deal: 'Deal' } as const;

// Type-ahead pick-list for the Lead / Project / Deal a task belongs to
function LinkPicker({ kind, value, onChange, invalid }: { kind: 'lead' | 'project' | 'deal'; value: Link; onChange: (v: Link) => void; invalid: boolean }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<LinkOption[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      setLoading(true);
      callApi<{ options: LinkOption[] }>(`/api/tasks/links?kind=${kind}&q=${encodeURIComponent(q)}`, 'GET')
        .then(d => live && setOptions(d.options)).catch(() => live && setOptions([])).finally(() => live && setLoading(false));
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q, open, kind]);

  useEffect(() => {
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  if (value) {
    return (
      <div className={`${input} flex items-center justify-between gap-2`}>
        <span className="truncate">{value.label}</span>
        <button type="button" onClick={() => onChange(null)} aria-label={`Change ${LINK_KIND[kind]}`} className="text-gray-500 hover:text-[#d9232b] shrink-0"><X className="w-4 h-4" /></button>
      </div>
    );
  }
  return (
    <div ref={root} className="relative">
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} aria-invalid={invalid || undefined}
        placeholder={`Search ${LINK_KIND[kind].toLowerCase()}...`} aria-label={`Search ${LINK_KIND[kind]}`} className={`${input} pr-9 ${invalid ? '!border-[#d9232b]' : ''}`} />
      <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
      {open && (
        <ul role="listbox" className="absolute z-20 mt-1 w-full max-h-56 overflow-auto bg-white border border-gray-200 rounded-md shadow-xl">
          {loading && <li className="px-3 py-2 text-[13px] text-gray-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Searching…</li>}
          {!loading && options.length === 0 && <li className="px-3 py-2 text-[13px] text-gray-500">No {LINK_KIND[kind].toLowerCase()} found</li>}
          {options.map(o => (
            <li key={o.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => { onChange(o); setOpen(false); setQ(''); }} className="w-full text-left px-3 py-2 text-[13px] hover:bg-gray-100">{o.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Errors = Record<string, string>;

const FULL_WIDTH = new Set(['title', 'notes']);

export default function CreateTaskModal({ mode, task, options, currentUserName, defaultType, fixedLink, onClose, onSaved }: {
  mode: 'create' | 'edit';
  task: TaskDetail | null; // required when editing
  options: TaskOptions;
  currentUserName: string;
  defaultType: TaskTypeId;
  fixedLink?: { type: 'project'; id: string; label: string }; // a task made inside a project: its type and its project are fixed
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  // The form follows the page layout: field order, labels, which fields are shown or required, the extra fields and the task types on offer
  const layout = options.layout;
  const creatable = layout.types.filter(t => t.creatable);
  const [type, setType] = useState<TaskTypeId>(fixedLink?.type ?? task?.taskType ?? (creatable.some(t => t.id === defaultType) ? defaultType : creatable[0]?.id ?? 'project'));
  const [title, setTitle] = useState(task?.title ?? '');
  const [assigneeId, setAssigneeId] = useState(task?.assignee?.id ?? '');
  const [startDate, setStartDate] = useState(task?.startRaw ?? '');
  const [startTime, setStartTime] = useState(task?.startTimeRaw ?? '09:00');
  const [dueDate, setDueDate] = useState(task?.dueRaw ?? '');
  const [dueTime, setDueTime] = useState(task?.dueTimeRaw ?? '18:00');
  const [notes, setNotes] = useState(task?.notes.text ?? '');
  const [priority, setPriority] = useState(task?.priority ?? 'Medium');
  const [proof, setProof] = useState(task?.requiresCompletionProof ?? true);
  const [statusLabel, setStatusLabel] = useState('');
  const [custom, setCustom] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(task?.customValues ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])));
  const [link, setLink] = useState<Link>(fixedLink ? { id: fixedLink.id, label: fixedLink.label } : task?.link ? { id: task.link.id, label: task.link.label } : null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, saving]);

  const needsLink = type === 'lead' || type === 'project' || type === 'deal';
  const changeType = (t: TaskTypeId) => { setType(t); setLink(null); setErrors(e => ({ ...e, leadId: '', projectId: '', dealId: '' })); };
  const clear = (k: string) => { if (errors[k]) setErrors(x => ({ ...x, [k]: '' })); };

  const shown = layout.fields.filter(f => !f.hidden);
  const field = (key: string) => layout.fields.find(f => f.key === key);
  const isShown = (key: string) => shown.some(f => f.key === key);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found: Errors = {};
    if (!title.trim()) found.title = `${field('title')?.label ?? 'Task Name'} is required`;
    if (needsLink && !link) found[`${type}Id`] = `Choose the ${LINK_KIND[type as 'lead']} for this task`;
    if (isShown('start') && field('start')?.required && !startDate) found.startDate = `${field('start')!.label} is required`;
    if (isShown('due') && field('due')?.required && !dueDate) found.dueDate = `${field('due')!.label} is required`;
    if (isShown('notes') && field('notes')?.required && !notes.trim()) found.notes = `${field('notes')!.label} is required`;
    for (const f of shown.filter(f => f.custom)) {
      const v = (custom[f.key] ?? '').trim();
      if (f.required && !v) found[f.key] = `${f.label} is required`;
      else if (v && f.type === 'number' && !Number.isFinite(Number(v))) found[f.key] = `${f.label} must be a number`;
    }
    if (!found.dueDate && dueDate && startDate && `${dueDate}T${dueTime}` < `${startDate}T${startTime}`) found.dueDate = 'The due date and time cannot be before the start';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;

    const payload = {
      ...(mode === 'create' ? { taskType: type } : {}),
      title: title.trim(),
      assigneeId: assigneeId || null,
      startDate: startDate || null, startTime: startDate ? startTime : null,
      dueDate: dueDate || null, dueTime: dueDate ? dueTime : null,
      notes: notes.trim() || null,
      priority,
      requiresCompletionProof: proof,
      statusLabel: statusLabel || null,
      customFields: Object.fromEntries(layout.fields.filter(f => f.custom).map(f => [f.key, (custom[f.key] ?? '').trim() || null])),
      leadId: type === 'lead' ? link?.id ?? null : null,
      projectId: type === 'project' ? link?.id ?? null : null,
      dealId: type === 'deal' ? link?.id ?? null : null,
    };
    setSaving(true);
    try {
      if (mode === 'create') await callApi('/api/tasks', 'POST', payload);
      else await callApi(`/api/tasks/${task!.id}`, 'PUT', payload);
      onSaved(mode === 'create' ? 'Task created' : 'Task updated');
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        setErrors(Object.fromEntries(error.details.map(d => [d.path, d.message])));
      }
      setFormError(error instanceof Error ? error.message : 'Could not save the task');
      setSaving(false);
    }
  };

  const star = (required: boolean) => required && <span className="text-[#d9232b]"> *</span>;
  const textarea = 'w-full border-2 border-gray-200 rounded-md px-3 py-2 text-[14px] text-gray-900 bg-white focus:outline-none focus:border-[#f5b800] resize-y';

  // One field of the form, drawn from its definition in the page layout
  const renderField = (f: (typeof layout.fields)[number]) => {
    const id = `tf-${f.key}`;
    const wrap = (children: React.ReactNode) => <div key={f.key} className={FULL_WIDTH.has(f.key) ? 'sm:col-span-2' : undefined}>{children}</div>;
    const labelEl = <label htmlFor={id} className={label}>{f.label}{star(f.required)}</label>;
    const error = errors[f.key] && <p role="alert" className={err}>{errors[f.key]}</p>;

    if (f.custom) {
      const value = custom[f.key] ?? '';
      const set = (v: string) => { setCustom(c => ({ ...c, [f.key]: v })); clear(f.key); };
      const bad = errors[f.key] ? '!border-[#d9232b]' : '';
      return wrap(<>
        {labelEl}
        {f.type === 'dropdown' ? (
          <select id={id} value={value} disabled={saving} onChange={e => set(e.target.value)} className={`${input} cursor-pointer ${bad}`}>
            <option value="">{f.required ? 'Select…' : '—'}</option>
            {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input id={id} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step={f.type === 'number' ? 'any' : undefined} value={value} maxLength={1000} disabled={saving}
            onChange={e => set(e.target.value)} aria-invalid={!!errors[f.key] || undefined} className={`${input} ${bad}`} />
        )}
        {error}
      </>);
    }

    switch (f.key) {
      case 'type':
        return wrap(<>
          <label htmlFor={id} className={label}>{f.label}</label>
          <select id={id} value={type} disabled={mode === 'edit' || saving || !!fixedLink} onChange={e => changeType(e.target.value)} className={`${input} cursor-pointer`}>
            {layout.types.filter(t => t.creatable || t.id === type).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </>);
      case 'assignedBy':
        return wrap(<>
          <label className={label}>{f.label}</label>
          <div className={`${input} flex items-center text-gray-600 bg-gray-50`}>{mode === 'edit' && task?.assignedBy ? task.assignedBy.name : currentUserName}</div>
        </>);
      case 'title':
        return wrap(<>
          <label htmlFor={id} className={label}>{f.label} <span className="text-[#d9232b]">*</span></label>
          <input id={id} value={title} maxLength={200} disabled={saving} onChange={e => { setTitle(e.target.value); clear('title'); }} aria-invalid={!!errors.title || undefined}
            className={`${input} ${errors.title ? '!border-[#d9232b]' : ''}`} placeholder="What needs to be done?" />
          {error}
        </>);
      case 'assignee':
        return wrap(<>
          <label htmlFor={id} className={label}>{f.label}</label>
          <select id={id} value={assigneeId} disabled={saving} onChange={e => setAssigneeId(e.target.value)} className={`${input} cursor-pointer`}>
            <option value="">Me ({currentUserName})</option>
            {options.employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.designation ? ` (${e.designation})` : ''}</option>)}
          </select>
          {errors.assigneeId && <p role="alert" className={err}>{errors.assigneeId}</p>}
        </>);
      case 'start':
        return wrap(<>
          {labelEl}
          <div className="flex gap-2">
            <input id={id} type="date" value={startDate} disabled={saving} onChange={e => { setStartDate(e.target.value); clear('startDate'); }} className={`${input} ${errors.startDate ? '!border-[#d9232b]' : ''}`} />
            <input type="time" aria-label="Start time" value={startTime} disabled={saving || !startDate} onChange={e => setStartTime(e.target.value)} className={`${input} w-[130px] shrink-0`} />
          </div>
          {errors.startDate && <p role="alert" className={err}>{errors.startDate}</p>}
        </>);
      case 'due':
        return wrap(<>
          {labelEl}
          <div className="flex gap-2">
            <input id={id} type="date" value={dueDate} disabled={saving} onChange={e => { setDueDate(e.target.value); clear('dueDate'); }} aria-invalid={!!errors.dueDate || undefined} className={`${input} ${errors.dueDate ? '!border-[#d9232b]' : ''}`} />
            <input type="time" aria-label="Due time" value={dueTime} disabled={saving || !dueDate} onChange={e => setDueTime(e.target.value)} className={`${input} w-[130px] shrink-0`} />
          </div>
          {errors.dueDate && <p role="alert" className={err}>{errors.dueDate}</p>}
        </>);
      case 'priority':
        return wrap(<>
          <label htmlFor={id} className={label}>{f.label}</label>
          <select id={id} value={priority} disabled={saving} onChange={e => setPriority(e.target.value)} className={`${input} cursor-pointer`}>
            {['Low', 'Medium', 'High'].map(p => <option key={p}>{p}</option>)}
          </select>
        </>);
      case 'proof':
        return (
          <label key={f.key} className="flex items-center gap-2.5 text-[14px] text-[#444] cursor-pointer select-none sm:pt-7">
            <input type="checkbox" checked={proof} disabled={saving} onChange={e => setProof(e.target.checked)} className="w-[18px] h-[18px] accent-black" />
            {f.label}
          </label>
        );
      case 'notes':
        return wrap(<>
          {labelEl}
          <textarea id={id} rows={3} maxLength={5000} value={notes} disabled={saving} onChange={e => { setNotes(e.target.value); clear('notes'); }} className={`${textarea} ${errors.notes ? '!border-[#d9232b]' : ''}`} placeholder="Add notes for the task person..." />
          {errors.notes && <p role="alert" className={err}>{errors.notes}</p>}
        </>);
      case 'status': {
        const extra = layout.statuses.filter(s => !s.builtin);
        return wrap(<>
          <label htmlFor={id} className={label}>{f.label}</label>
          <select id={id} value={statusLabel} disabled={saving} onChange={e => setStatusLabel(e.target.value)} className={`${input} cursor-pointer`}>
            <option value="">{mode === 'edit' && task ? `Keep current (${task.status})` : 'Default (Not Started)'}</option>
            {mode === 'edit' && <option value="Not Started">Not Started</option>}
            {extra.map(s => <option key={s.id} value={s.label}>{s.label}</option>)}
          </select>
        </>);
      }
      default:
        return null;
    }
  };

  // The Lead / Project / Deal picker follows the Task Type (and Assigned By, which pairs with it) field
  const linkAfter = [field('type'), isShown('assignedBy') ? field('assignedBy') : undefined].filter(Boolean).map(f => layout.fields.indexOf(f!)).reduce((a, b) => Math.max(a, b), 0);
  const linkBlock = needsLink && (
    <div key="link" className="sm:col-span-2">
      <label className={label}>{LINK_KIND[type as 'lead']} <span className="text-[#d9232b]">*</span></label>
      {fixedLink ? <div className={`${input} flex items-center bg-gray-50 text-gray-700`}>{fixedLink.label}</div> : <LinkPicker key={type} kind={type as 'lead'} value={link} onChange={setLink} invalid={!!errors[`${type}Id`]} />}
      {errors[`${type}Id`] && <p role="alert" className={err}>{errors[`${type}Id`]}</p>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-4">
      <form role="dialog" aria-modal="true" aria-labelledby="task-form-title" onSubmit={submit} noValidate
        className="bg-white w-full sm:max-w-[680px] max-h-screen sm:max-h-[94vh] overflow-y-auto sm:rounded-lg shadow-2xl px-6 py-6">
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 id="task-form-title" className="text-[20px] font-bold text-[#333]">{mode === 'create' ? 'Create New Task' : 'Edit Task'}</h2>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="text-gray-500 hover:text-black disabled:opacity-40"><X className="w-6 h-6" /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          {layout.fields.map((f, i) => (f.hidden ? null : <Fragment key={f.key}>{renderField(f)}{i === linkAfter ? linkBlock : null}</Fragment>))}
        </div>

        {formError && <p role="alert" className="mt-4 text-[13px] text-[#d9232b]">{formError}</p>}
        <div className="mt-6 flex items-center justify-end gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="px-5 h-[40px] rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-[14px] font-medium disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 px-5 h-[40px] rounded-lg bg-[#f5b800] hover:bg-[#e0a800] text-[#1f1f1f] text-[14px] font-semibold disabled:opacity-60">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{mode === 'create' ? 'Create Task' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
