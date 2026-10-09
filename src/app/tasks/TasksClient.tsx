'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronLeft, ChevronRight, ClipboardList, X } from 'lucide-react';
import { callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import LightConfirm from '@/app/leads/components/LightConfirm';
import { type TaskListParams, type TaskSortKey } from '@/lib/tasks/rules';
import { TASK_VIEWS } from '@/lib/tasks/rules';
import { TaskLayoutButton } from './components/TaskLayoutEditor';
import type { TaskDetail, TaskListResult, TaskOptions, TaskRow } from '@/lib/tasks/types';
import CreateTaskModal from './components/CreateTaskModal';
import TaskDetailsModal from './components/TaskDetailsModal';
import TaskTable, { type RowAction } from './components/TaskTable';
import TaskToolbar from './components/TaskToolbar';

type Dialog =
  | { kind: 'create' }
  | { kind: 'edit'; task: TaskDetail }
  | { kind: 'details'; id: string; focus?: 'files' }
  | { kind: 'delete'; row: TaskRow }
  | null;


export default function TasksClient({ data, params, options, canCreate, currentUserName }: {
  data: TaskListResult;
  params: TaskListParams;
  options: TaskOptions;
  canCreate: boolean;
  currentUserName: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? '');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Every filter lives in the address, so the server loads exactly the page that is shown (50 tasks) and links can be shared
  const setParams = (updates: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.delete('page');
    startTransition(() => (replace ? router.replace : router.push)(`/tasks${next.toString() ? `?${next}` : ''}`));
  };

  // Live search: results update shortly after typing stops, and the search respects the selected type and status
  useEffect(() => {
    if ((params.q ?? '') === q.trim()) return;
    const t = setTimeout(() => setParams({ q: q.trim() || undefined }, true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const refresh = () => router.refresh();

  const act = async (row: TaskRow, action: RowAction) => {
    setBusyId(row.id);
    try {
      const res = await callApi<{ starred?: boolean }>(`/api/tasks/${row.id}`, 'PATCH', { action });
      toast.success(action === 'start' ? 'Task started' : action === 'complete' ? 'Task completed' : res.starred ? 'Added to favorites' : 'Removed from favorites');
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusyId(null);
    }
  };

  const openEdit = async (row: TaskRow) => {
    try { setDialog({ kind: 'edit', task: (await callApi<{ task: TaskDetail }>(`/api/tasks/${row.id}`, 'GET')).task }); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not open the task'); }
  };

  const confirmDelete = async () => {
    if (dialog?.kind !== 'delete') return;
    setDeleting(true);
    try { await callApi(`/api/tasks/${dialog.row.id}`, 'DELETE'); toast.success('Task deleted'); setDialog(null); refresh(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Could not delete the task'); }
    finally { setDeleting(false); }
  };

  const onSort = (key: TaskSortKey) => {
    if (params.sort === key) setParams({ sort: key, dir: params.dir === 'asc' ? 'desc' : 'asc' });
    else setParams({ sort: key, dir: 'desc' });
  };

  const filtersOn = !!(params.q || params.from || params.to);
  const layout = options.layout;
  // The type pills and status tabs follow Edit Page Layout; the one that is open is always shown, even if it was hidden since
  const typeLabel = (id: string) => layout.types.find(t => t.id === id)?.label ?? 'Task';
  const typePills = layout.types.filter(t => !t.hidden || t.id === params.type);
  const statusTabs = layout.statuses.filter(s => !s.hidden || s.id === params.view);
  const viewStatus = layout.statuses.find(s => s.id === params.view);
  const view = { label: viewStatus?.label ?? 'Tasks', empty: TASK_VIEWS.find(v => v.id === params.view)?.empty ?? 'No tasks with this status' };
  const pageButtons = Array.from({ length: data.pageCount }, (_, i) => i + 1).filter(p => p === 1 || p === data.pageCount || Math.abs(p - data.page) <= 2);
  const offset = (data.page - 1) * data.pageSize;

  const pill = (active: boolean) => `px-4 h-[38px] rounded-full border text-[13px] font-medium whitespace-nowrap transition-colors ${active ? 'bg-[#f5b800] border-[#f5b800] text-[#1f1f1f] font-semibold' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`;

  return (
    <div data-light-native className="w-full min-h-screen bg-white text-[#333] font-sans">
      <div className="px-4 sm:px-5 pt-6 pb-10 max-w-[2000px] mx-auto">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-9 h-9 rounded-full bg-[#f5b800] flex items-center justify-center shrink-0"><Check className="w-5 h-5 text-white" strokeWidth={3} /></span>
            <h1 className="text-[26px] sm:text-[30px] font-medium text-[#3a3a3a] leading-tight">Task Management</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {options.canEditLayout && <TaskLayoutButton layout={layout} />}
            <TaskToolbar params={params} q={q} onQ={setQ} canCreate={canCreate} types={typePills}
              onType={t => setParams({ type: t })} onDates={u => setParams(u)} onAdd={() => setDialog({ kind: 'create' })} />
          </div>
        </div>

        <section aria-label="Task Type" className="mt-6 border border-gray-200 rounded-lg px-4 py-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Task Type</h2>
          <div className="flex flex-wrap gap-2">
            {typePills.map(t => <button key={t.id} type="button" aria-pressed={params.type === t.id} onClick={() => setParams({ type: t.id })} className={pill(params.type === t.id)}>{t.label}</button>)}
          </div>
        </section>

        <section aria-label="Task Status" className="mt-3 border border-gray-200 rounded-lg px-4 py-3">
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">Task Status</h2>
          <div className="flex flex-wrap gap-2">
            {statusTabs.map(v => (
              <button key={v.id} type="button" aria-pressed={params.view === v.id} onClick={() => setParams({ view: v.id })} className={`${pill(params.view === v.id)} inline-flex items-center gap-2`}>
                {v.label}
                <span className={`min-w-[22px] px-1.5 h-[20px] rounded-full text-[11px] font-bold inline-flex items-center justify-center ${params.view === v.id ? 'bg-white/70 text-[#1f1f1f]' : 'bg-gray-100 text-gray-600'}`}>{data.counts[v.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] text-gray-500">{typeLabel(params.type)} <span aria-hidden>→</span><span className="sr-only">then</span> {view.label}</p>
            <h2 className="text-[20px] font-semibold text-[#333]" aria-live="polite">{view.label} ({data.total})</h2>
          </div>
          {filtersOn && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {params.q && <span className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-3 pr-1.5 py-1">Search: {params.q}<button type="button" aria-label="Clear search" onClick={() => { setQ(''); setParams({ q: undefined }); }}><X className="w-3.5 h-3.5" /></button></span>}
              {(params.from || params.to) && <span className="inline-flex items-center gap-1 bg-gray-100 rounded-full pl-3 pr-1.5 py-1">{params.dateField ?? 'due'} date: {params.from ?? '…'} to {params.to ?? '…'}<button type="button" aria-label="Clear dates" onClick={() => setParams({ dateField: undefined, from: undefined, to: undefined })}><X className="w-3.5 h-3.5" /></button></span>}
            </div>
          )}
        </div>

        <div className={`mt-3 transition-opacity ${pending ? 'opacity-60' : ''}`} aria-busy={pending}>
          {data.rows.length === 0 ? (
            <div className="py-20 text-center text-gray-500 border border-dashed border-gray-300 rounded-lg">
              <ClipboardList className="w-10 h-10 mx-auto text-gray-300" />
              <div className="mt-2 text-[16px] font-semibold text-gray-700">{view.empty}</div>
              <div className="text-[13px] mt-1">{filtersOn ? 'Try clearing the search or the date filter.' : `There are no ${typeLabel(params.type).toLowerCase()}s here right now.`}</div>
            </div>
          ) : (
            <TaskTable rows={data.rows} view={params.view} offset={offset} sort={params.sort} dir={params.dir} busyId={busyId}
              onSort={onSort} onAction={act} onDetails={(r, focus) => setDialog({ kind: 'details', id: r.id, focus })} onEdit={openEdit} onDelete={r => setDialog({ kind: 'delete', row: r })} />
          )}
        </div>

        {data.total > 0 && (
          <nav aria-label="Pagination" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[13px] text-gray-600">
            <span>Showing {offset + 1}–{offset + data.rows.length} of {data.total}</span>
            <div className="flex items-center gap-1">
              <button type="button" disabled={data.page <= 1} onClick={() => setParams({ page: String(data.page - 1) })} aria-label="Previous page" className="w-9 h-9 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              {pageButtons.map((p, i) => (
                <span key={p} className="flex items-center">
                  {i > 0 && p - pageButtons[i - 1] > 1 && <span className="px-1">…</span>}
                  <button type="button" onClick={() => setParams({ page: String(p) })} aria-current={p === data.page ? 'page' : undefined}
                    className={`min-w-9 h-9 px-2 rounded border text-[13px] ${p === data.page ? 'bg-[#f5b800] border-[#f5b800] font-semibold text-[#1f1f1f]' : 'border-gray-300 hover:bg-gray-50'}`}>{p}</button>
                </span>
              ))}
              <button type="button" disabled={data.page >= data.pageCount} onClick={() => setParams({ page: String(data.page + 1) })} aria-label="Next page" className="w-9 h-9 rounded border border-gray-300 flex items-center justify-center hover:bg-gray-50 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </nav>
        )}
      </div>

      {dialog?.kind === 'create' && <CreateTaskModal mode="create" task={null} options={options} currentUserName={currentUserName} defaultType={params.type} onClose={() => setDialog(null)} onSaved={m => { setDialog(null); toast.success(m); refresh(); }} />}
      {dialog?.kind === 'edit' && <CreateTaskModal mode="edit" task={dialog.task} options={options} currentUserName={currentUserName} defaultType={params.type} onClose={() => setDialog(null)} onSaved={m => { setDialog(null); toast.success(m); refresh(); }} />}
      {dialog?.kind === 'details' && <TaskDetailsModal key={dialog.id} taskId={dialog.id} focus={dialog.focus} onClose={() => setDialog(null)} onEdit={t => setDialog({ kind: 'edit', task: t })} onChanged={refresh} />}
      {dialog?.kind === 'delete' && (
        <LightConfirm title="Delete this task?" confirmLabel="Delete" danger busy={deleting} onConfirm={confirmDelete} onCancel={() => setDialog(null)}>
          <p><b>{dialog.row.title}</b> will be deleted permanently, with its files and history.</p>
        </LightConfirm>
      )}
    </div>
  );
}
