'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown, Plus, Search } from 'lucide-react';
import { TASK_DATE_FIELDS, type TaskDateField, type TaskListParams, type TaskTypeId } from '@/lib/tasks/rules';
import type { TypeDef } from '@/lib/tasks/layout-shared';

const field = 'w-full border border-gray-300 rounded px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-[#f5b800]';

export default function TaskToolbar({ params, q, onQ, canCreate, types, onType, onDates, onAdd }: {
  params: TaskListParams;
  q: string;
  onQ: (v: string) => void;
  canCreate: boolean;
  types: TypeDef[];
  onType: (t: TaskTypeId) => void;
  onDates: (u: { dateField?: string; from?: string; to?: string }) => void;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dateField, setDateField] = useState<TaskDateField>(params.dateField ?? 'due');
  const [from, setFrom] = useState(params.from ?? '');
  const [to, setTo] = useState(params.to ?? '');
  const root = useRef<HTMLDivElement>(null);
  const active = !!(params.from || params.to);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); };
  }, [open]);

  const apply = () => { onDates({ dateField, from: from || undefined, to: to || undefined }); setOpen(false); };
  const clear = () => { setFrom(''); setTo(''); onDates({ dateField: undefined, from: undefined, to: undefined }); setOpen(false); };

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="relative w-full sm:w-[260px]">
        <input value={q} onChange={e => onQ(e.target.value)} placeholder="Search tasks..." aria-label="Search tasks"
          className="w-full h-[42px] border-2 border-gray-200 rounded px-3.5 pr-10 text-[14px] text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#f5b800] bg-white" />
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-600 pointer-events-none" />
      </div>

      <div className="relative">
        <select value={params.type} onChange={e => onType(e.target.value as TaskTypeId)} aria-label="Task Type"
          className="h-[42px] appearance-none border-2 border-gray-200 rounded pl-3.5 pr-9 text-[14px] text-gray-800 bg-white focus:outline-none focus:border-[#f5b800] cursor-pointer">
          {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-600 pointer-events-none" />
      </div>

      <div ref={root} className="relative">
        <button type="button" onClick={() => setOpen(o => !o)} aria-label="Filter by date" aria-expanded={open} title="Filter by date"
          className="relative w-[42px] h-[42px] rounded border-2 border-gray-200 hover:bg-gray-50 flex items-center justify-center text-gray-800">
          <Calendar className="w-5 h-5" />
          {active && <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-[#d9232b]" />}
        </button>
        {open && (
          <div className="absolute right-0 top-12 z-40 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-4 space-y-3">
            <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide">Filter by date</div>
            <label className="block text-[12px] text-gray-600">Date
              <select className={`${field} mt-1`} value={dateField} onChange={e => setDateField(e.target.value as TaskDateField)}>
                {TASK_DATE_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            </label>
            <label className="block text-[12px] text-gray-600">From
              <input type="date" className={`${field} mt-1`} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
            </label>
            <label className="block text-[12px] text-gray-600">To
              <input type="date" className={`${field} mt-1`} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
            </label>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={clear} className="text-[12px] text-[#d9232b] font-semibold">Clear dates</button>
              <button type="button" onClick={apply} disabled={!from && !to} className="px-4 h-[34px] rounded bg-[#f5b800] hover:bg-[#e0a800] text-[#1f1f1f] text-[13px] font-semibold disabled:opacity-50">Apply</button>
            </div>
          </div>
        )}
      </div>

      {canCreate && (
        <button type="button" onClick={onAdd} title="Create New Task" aria-label="Create New Task"
          className="w-[42px] h-[42px] flex items-center justify-center border-2 border-[#f5b800] rounded-[3px] text-[#f5b800] hover:bg-[#fff8dc] transition-colors">
          <Plus className="w-6 h-6" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
