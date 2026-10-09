'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, CheckCircle2, CloudUpload, Eye, List, MoreVertical, Pencil, Play, Star, Trash2, User } from 'lucide-react';
import type { TaskSortKey, TaskViewId } from '@/lib/tasks/rules';
import type { TaskRow } from '@/lib/tasks/types';
import { remainingClass, StatusBadge, TypeTag } from './badges';

export type RowAction = 'star' | 'start' | 'complete';

type Props = {
  rows: TaskRow[];
  view: TaskViewId;
  offset: number; // rows on earlier pages, so S no continues across pages
  sort?: TaskSortKey;
  dir: 'asc' | 'desc';
  busyId: string | null;
  onSort: (key: TaskSortKey) => void;
  onAction: (row: TaskRow, action: RowAction) => void;
  onDetails: (row: TaskRow, focus?: 'files') => void;
  onEdit: (row: TaskRow) => void;
  onDelete: (row: TaskRow) => void;
};

const th = 'sticky top-0 z-20 bg-gray-50 border-b border-gray-200 px-3 py-2.5 text-[12px] font-semibold text-[#444] whitespace-nowrap align-middle';
const td = 'px-3 py-2.5 align-top border-b border-gray-100 group-hover:bg-[#fffdf3]';
const iconBtn = 'w-7 h-7 rounded flex items-center justify-center text-gray-600 hover:bg-gray-100 hover:text-black disabled:opacity-40 disabled:cursor-not-allowed';

function SortHead({ label, k, sort, dir, onSort }: { label: string; k: TaskSortKey; sort?: TaskSortKey; dir: 'asc' | 'desc'; onSort: (k: TaskSortKey) => void }) {
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button type="button" onClick={() => onSort(k)} aria-label={`Sort by ${label}`} className="inline-flex items-center gap-1 hover:text-black">
      {label}<Icon className={`w-3.5 h-3.5 ${active ? 'text-[#d9232b]' : 'text-gray-400'}`} />
    </button>
  );
}

// "More": View Details, Edit, Start, Delete (only what the user may do). Fixed positioning so the table's scroll area never clips it.
function MoreMenu({ row, onDetails, onEdit, onStart, onDelete }: { row: TaskRow; onDetails: () => void; onEdit: () => void; onStart: () => void; onDelete: () => void }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    const outside = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [pos]);

  const item = 'w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left hover:bg-gray-100';
  return (
    <div ref={root}>
      <button type="button" aria-label={`More options for ${row.title}`} title="More" aria-haspopup="menu" aria-expanded={!!pos} className={iconBtn}
        onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setPos(pos ? null : { top: r.bottom + 4, right: window.innerWidth - r.right }); }}>
        <MoreVertical className="w-4 h-4" />
      </button>
      {pos && (
        <div role="menu" style={{ top: pos.top, right: pos.right }} className="fixed z-[60] w-44 bg-white border border-gray-200 rounded-lg shadow-xl py-1">
          <button role="menuitem" className={item} onClick={() => { setPos(null); onDetails(); }}><Eye className="w-4 h-4" />View Details</button>
          {row.can.edit && <button role="menuitem" className={item} onClick={() => { setPos(null); onEdit(); }}><Pencil className="w-4 h-4" />Edit Task</button>}
          {row.can.start && <button role="menuitem" className={item} onClick={() => { setPos(null); onStart(); }}><Play className="w-4 h-4" />Start Task</button>}
          {row.can.delete && <button role="menuitem" className={`${item} text-[#d9232b]`} onClick={() => { setPos(null); onDelete(); }}><Trash2 className="w-4 h-4" />Delete Task</button>}
        </div>
      )}
    </div>
  );
}

export default function TaskTable({ rows, view, offset, sort, dir, busyId, onSort, onAction, onDetails, onEdit, onDelete }: Props) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-auto max-h-[calc(100vh-240px)] min-h-[200px] bg-white">
      <table className="w-full min-w-[1500px] text-left border-collapse text-[12px]">
        <thead>
          <tr>
            <th className={th}>S no</th>
            <th className={th}><SortHead label="Assigned D&T" k="assigned" sort={sort} dir={dir} onSort={onSort} /></th>
            <th className={th}><SortHead label="Start Date" k="start" sort={sort} dir={dir} onSort={onSort} /></th>
            <th className={th}>Staff Assignment</th>
            <th className={th}>Lead ID</th>
            <th className={th}>Task Name</th>
            <th className={th}><SortHead label="Task Due D&T" k="due" sort={sort} dir={dir} onSort={onSort} /></th>
            <th className={th}>Notes</th>
            <th className={th}>Status</th>
            <th className={`${th} !right-0 !sticky z-30 text-center shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const busy = busyId === t.id;
            const proofMissing = t.requiresCompletionProof && t.filesCount === 0;
            return (
              <tr key={t.id} className="group">
                <td className={`${td} text-gray-600`}>{offset + i + 1}</td>
                <td className={`${td} whitespace-nowrap text-gray-700`}>{t.assigned.date}<br />{t.assigned.time}</td>
                <td className={`${td} whitespace-nowrap text-gray-700`}>{t.start ? <>{t.start.date}<br />{t.start.time}</> : '-'}</td>
                <td className={td}>
                  <div className="space-y-0.5 min-w-[110px]">
                    <div title="Task person" className="flex items-center gap-1.5 font-semibold text-[#333]"><User className="w-3.5 h-3.5 text-[#d9232b] shrink-0" fill="currentColor" /><span className="sr-only">Task person: </span>{t.assignee?.name ?? 'Unassigned'}</div>
                    <div title="Task assigned person" className="flex items-center gap-1.5 text-gray-600"><List className="w-3.5 h-3.5 shrink-0" /><span className="sr-only">Assigned by: </span>{t.assignedBy?.name ?? '-'}</div>
                  </div>
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {t.lead ? <Link href={`/leads?view=${t.lead.id}`} title="Open this lead" className="text-[#2f80ed] font-semibold hover:underline">{t.lead.code}</Link> : '-'}
                </td>
                <td className={`${td} min-w-[190px] max-w-[260px]`}>
                  <button type="button" onClick={() => onDetails(t)} className="text-left font-semibold text-[#333] hover:underline break-words">{t.title}</button>
                  <div className="mt-1"><TypeTag type={t.taskType} label={t.typeLabel} /></div>
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {t.due ? <>{t.due.date}<br />{t.due.time}</> : <span className="text-gray-500">Not set</span>}
                  <div className={`mt-1 ${view === 'completed' ? 'text-gray-600' : remainingClass(t.remaining)}`}>
                    {view === 'completed' ? (t.completed ? `${t.completed.date} ${t.completed.time}` : '-') : t.remaining}
                  </div>
                </td>
                <td className={`${td} min-w-[220px] max-w-[300px]`}>
                  {t.notes.customerName && (
                    <div className="mb-1"><strong>{t.notes.customerName}</strong>{t.notes.contactNumber ? ` (${t.notes.contactNumber})` : ''}</div>
                  )}
                  {t.notes.customerName && t.notes.requirement && <div className="mb-1 bg-gray-50 rounded px-1.5 py-1 italic text-gray-600 break-words">{t.notes.requirement}</div>}
                  {t.notes.text ? <div className={`whitespace-pre-line break-words ${t.notes.customerName ? 'border-t border-dashed border-gray-200 pt-1' : ''}`}>{t.notes.text}</div> : !t.notes.customerName && <span className="text-gray-400">No notes</span>}
                </td>
                <td className={td}>
                  <StatusBadge status={t.status} />
                  {t.statusAgo && <div className="mt-1 text-[11px] text-gray-500 whitespace-nowrap">{t.statusAgo}</div>}
                </td>
                <td className={`${td} !sticky right-0 z-10 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]`}>
                  <div className="flex items-center justify-center gap-0.5">
                    {t.can.star && (
                      <button type="button" disabled={busy} onClick={() => onAction(t, 'star')} aria-pressed={t.starred} aria-label={t.starred ? `Remove ${t.title} from favorites` : `Add ${t.title} to favorites`} title={t.starred ? 'Remove from favorites' : 'Add to favorites'} className={iconBtn}>
                        <Star className={`w-4 h-4 ${t.starred ? 'fill-[#f5b800] text-[#f5b800]' : ''}`} />
                      </button>
                    )}
                    {(t.can.upload || t.filesCount > 0) && (
                      <button type="button" onClick={() => onDetails(t, 'files')} aria-label={t.can.upload ? `Upload or view files of ${t.title}` : `View files of ${t.title}`} title={t.filesCount ? `${t.filesCount} file${t.filesCount > 1 ? 's' : ''}: view${t.can.upload ? ' or add' : ''}` : 'Upload files'} className={iconBtn}>
                        {t.filesCount > 0 ? <CheckCircle2 className="w-4 h-4 text-[#16a34a]" /> : <CloudUpload className="w-4 h-4" />}
                      </button>
                    )}
                    {t.can.start && (
                      <button type="button" disabled={busy} onClick={() => onAction(t, 'start')} aria-label={`Start ${t.title}`} title="Start task" className={iconBtn}><Play className="w-4 h-4" /></button>
                    )}
                    {t.can.complete && (
                      <button type="button" disabled={busy || proofMissing} onClick={() => onAction(t, 'complete')} aria-label={`Complete ${t.title}`} title={proofMissing ? 'Upload a proof file first' : 'Complete task'}
                        className="w-7 h-7 rounded flex items-center justify-center text-[#16a34a] hover:bg-green-50 disabled:text-gray-300 disabled:hover:bg-transparent disabled:cursor-not-allowed"><Check className="w-4.5 h-4.5" strokeWidth={3} /></button>
                    )}
                    <MoreMenu row={t} onDetails={() => onDetails(t)} onEdit={() => onEdit(t)} onStart={() => onAction(t, 'start')} onDelete={() => onDelete(t)} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
