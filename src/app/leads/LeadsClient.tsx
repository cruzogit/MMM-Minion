'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { FOLLOWUP_NEEDED_MESSAGE, MIN_FOLLOWUPS_TO_CONVERT, STATUS_FILTER_ITEMS, type ColumnFilterKey, type LeadFilterId, type LeadFormOptions, type LeadSortKey } from '@/lib/leads/constants';
import type { LeadListParams, LeadRow } from '@/lib/leads/queries';
import { callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import LeadHeader from './components/LeadHeader';
import LeadToolbar from './components/LeadToolbar';
import LeadSummary from './components/LeadSummary';
import LeadSearch from './components/LeadSearch';
import LeadFilters from './components/LeadFilters';
import LeadTable from './components/LeadTable';
import AddLeadModal from './components/AddLeadModal';
import ViewLeadModal from './components/ViewLeadModal';
import PageLayoutEditor from './components/PageLayoutEditor';
import FollowUpModal from './components/FollowUpModal';
import FollowUpFilesModal from './components/FollowUpFilesModal';
import CloseLeadModal from './components/CloseLeadModal';
import ConvertLeadModal from './components/ConvertLeadModal';
import ImportLeadsModal from './components/ImportLeadsModal';

type Data = {
  rows: LeadRow[];
  summary: { total: number; showing: number };
  page: number;
  pageCount: number;
  pageSize: number;
};

type Dialog = { kind: 'add' } | { kind: 'edit'; row: LeadRow } | { kind: 'view'; row: LeadRow } | { kind: 'delete'; row: LeadRow } | { kind: 'duplicate'; row: LeadRow } | { kind: 'layout' } | { kind: 'followup'; row: LeadRow } | { kind: 'followups'; row: LeadRow } | { kind: 'close'; row: LeadRow } | { kind: 'reopen'; row: LeadRow } | { kind: 'convert'; row: LeadRow } | { kind: 'needFollowUp'; row: LeadRow } | { kind: 'import' } | null;

export default function LeadsClient({ data, params, options, currentEmployeeId, abilities, storageReady }: {
  data: Data;
  params: LeadListParams;
  options: LeadFormOptions;
  currentEmployeeId: string | null;
  abilities: { create: boolean; edit: boolean; delete: boolean; convert: boolean; export: boolean; layout: boolean };
  storageReady: boolean;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? '');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  // While a reset is on its way, the search box's own delayed update must not put the old search/filters back in the address
  const resetting = useRef(false);

  const setParams = (updates: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.delete('page');
    startTransition(() => (replace ? router.replace : router.push)(`/leads${next.toString() ? `?${next}` : ''}`));
  };

  // Live search: results update about 0.15s after each keystroke (runs on the server, so only the matching page of rows is loaded)
  useEffect(() => {
    if (resetting.current || (params.q ?? '') === q.trim()) return;
    const t = setTimeout(() => setParams({ q: q.trim() || undefined }, true), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const exportHref = `/api/leads/export${search.toString() ? `?${search}` : ''}`;

  const afterSave = (message: string) => {
    setDialog(null);
    toast.success(message);
    router.refresh();
  };

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); setDialog(null); router.refresh(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  const handlersFor = (row: LeadRow) => ({
    onView: () => setDialog({ kind: 'view', row }),
    onEdit: () => setDialog({ kind: 'edit', row }),
    // A lead has to be followed up first (the number in its Follow-up column): without that another popup explains it
    onConvert: () => setDialog({ kind: row.followUpCount >= MIN_FOLLOWUPS_TO_CONVERT ? 'convert' : 'needFollowUp', row }),
    onCloseLead: () => setDialog({ kind: 'close', row }),
    onReopen: () => setDialog({ kind: 'reopen', row }),
    onDuplicate: () => setDialog({ kind: 'duplicate', row }),
    onDelete: () => setDialog({ kind: 'delete', row }),
  });

  const group = (key: ColumnFilterKey, label: string, items: { value: string; label: string }[]) => ({ key, label, items, selected: params.cols?.[key] ?? [] });
  const people = options.employees.map(e => ({ value: e.id, label: e.name }));
  const filterGroups = {
    customer: [group('customer', 'Customer details', options.customerNames.map(n => ({ value: n, label: n })))],
    requirement: [group('requirement', 'Requirements', options.exactRequirements.map(t => ({ value: t, label: t })))],
    assigned: [group('leadPerson', 'Lead Person', people), group('assigned', 'Task Assigned Person', people)],
    status: [group('status', 'Lead Status', options.leadStatuses.map(o => ({ value: o.id, label: o.label })))],
    state: [group('state', 'Status', STATUS_FILTER_ITEMS.map(o => ({ value: o.value, label: o.label })))],
    source: [group('source', 'Source', options.sources.map(o => ({ value: o.id, label: o.label })))],
    category: [group('category', 'Categories', options.mainCategories.map(o => ({ value: o.id, label: o.label })))],
    location: [group('location', 'Location', options.locations.map(l => ({ value: l, label: l })))],
  };

  // Emptying the Lead Person filter is written as [] instead of leaving it out of the address: a bare address means "start with my own leads"
  const onFilter = (next: Partial<Record<ColumnFilterKey, string[]>>) =>
    setParams(Object.fromEntries(Object.entries(next).map(([k, v]) => [`f_${k}`, v && v.length ? JSON.stringify(v) : k === 'leadPerson' ? '[]' : undefined])));

  // Click on the Total Leads number: show every lead. The search, quick filters, column filters and dates are dropped (the sorting
  // stays) and the Lead Person filter is switched off explicitly, so it does not start again with the signed-in person's leads.
  const showAll = () => {
    resetting.current = true;
    setQ('');
    const next = new URLSearchParams({ f_leadPerson: '[]' });
    for (const k of ['sort', 'dir']) { const v = search.get(k); if (v) next.set(k, v); }
    startTransition(() => { router.push(`/leads?${next}`); router.refresh(); });
  };

  // Clears the search, every filter and the sorting, then reloads the list (it starts again with the signed-in person's own leads)
  const clearAll = () => {
    resetting.current = true;
    setQ('');
    startTransition(() => { router.push('/leads'); router.refresh(); });
  };
  useEffect(() => { resetting.current = false; }, [data]);

  return (
    <div data-light-native className="w-full min-h-screen bg-white text-[#333] font-sans">
      <div className="px-4 sm:px-5 pt-6 pb-10 max-w-[2000px] mx-auto">
        <LeadHeader />

        <div className="mt-6 flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-x-5 gap-y-3 pb-5 border-b-[3px] border-gray-200">
          <LeadSummary total={data.summary.total} showing={data.summary.showing} onShowAll={showAll} />
          <LeadSearch value={q} onChange={setQ} />
          <LeadFilters active={params.filter} onChange={(id: LeadFilterId | undefined) => setParams({ filter: id })} />
          <LeadToolbar
            className="self-end lg:self-auto lg:ml-auto"
            params={params}
            canCreate={abilities.create}
            canExport={abilities.export}
            canImport={abilities.create}
            canEditLayout={abilities.layout}
            refreshing={pending}
            onAdd={() => setDialog({ kind: 'add' })}
            onEditLayout={() => setDialog({ kind: 'layout' })}
            onRefresh={clearAll}
            onParams={setParams}
            onImport={() => setDialog({ kind: 'import' })}
            exportHref={exportHref}
            showImport={true}
          />
        </div>

        <div className="mt-4">
          <LeadTable
            rows={data.rows}
            sort={params.sort}
            dir={params.dir === 'asc' ? 'asc' : 'desc'}
            abilities={abilities}
            loading={pending}
            columnOrder={options.columnOrder}
            filterGroups={filterGroups}
            onFilter={onFilter}
            onSort={(k: LeadSortKey, d) => setParams({ sort: k, dir: d })}
            onReset={clearAll}
            onFollowUp={row => setDialog({ kind: 'followup', row })}
            onViewFollowUps={row => setDialog({ kind: 'followups', row })}
            inline={{
              leadStatuses: options.leadStatuses,
              required: {
                amount: !!options.fields.find(f => f.key === 'amount')?.required,
                leadStatusId: !!options.fields.find(f => f.key === 'leadStatusId')?.required,
                location: !!options.fields.find(f => f.key === 'location')?.required,
                exactLocation: !!options.fields.find(f => f.key === 'exactLocation')?.required,
              },
              onSaved: () => router.refresh(),
            }}
            handlersFor={handlersFor}
          />
        </div>

        {(data.pageCount > 1 || data.pageSize !== 50) && (
          <div className="mt-5 flex items-center justify-end gap-3 text-[13px] text-gray-600">
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            <span className="flex items-center gap-1">
              Page 
              <input 
                type="number" 
                min={1} 
                max={data.pageCount} 
                defaultValue={data.page}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const p = parseInt(e.currentTarget.value);
                    if (p >= 1 && p <= data.pageCount && p !== data.page) setParams({ page: String(p) });
                  }
                }}
                onBlur={e => {
                  const p = parseInt(e.currentTarget.value);
                  if (p >= 1 && p <= data.pageCount && p !== data.page) setParams({ page: String(p) });
                  else e.currentTarget.value = String(data.page);
                }}
                className="w-12 h-8 mx-1 px-1 border border-gray-300 rounded text-center outline-none focus:border-[#548df6]"
              />
              of {data.pageCount}
            </span>
            <span className="flex items-center gap-1 border-l border-gray-300 pl-3">
              <input 
                type="number" 
                min={1} 
                max={1000} 
                defaultValue={data.pageSize}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const l = parseInt(e.currentTarget.value);
                    if (l >= 1 && l <= 1000 && l !== data.pageSize) setParams({ limit: String(l), page: '1' });
                  }
                }}
                onBlur={e => {
                  const l = parseInt(e.currentTarget.value);
                  if (l >= 1 && l <= 1000 && l !== data.pageSize) setParams({ limit: String(l), page: '1' });
                  else e.currentTarget.value = String(data.pageSize);
                }}
                className="w-14 h-8 mx-1 px-1 border border-gray-300 rounded text-center outline-none focus:border-[#548df6]"
              />
              per page
            </span>
            <div className="flex gap-1 ml-1">
              <button disabled={data.page <= 1} onClick={() => setParams({ page: String(data.page - 1) })} aria-label="Previous page" className="w-8 h-8 border border-gray-300 rounded flex items-center justify-center disabled:opacity-40 hover:bg-gray-100"><ChevronLeft className="w-4 h-4" /></button>
              <button disabled={data.page >= data.pageCount} onClick={() => setParams({ page: String(data.page + 1) })} aria-label="Next page" className="w-8 h-8 border border-gray-300 rounded flex items-center justify-center disabled:opacity-40 hover:bg-gray-100"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {dialog?.kind === 'add' && <AddLeadModal mode="create" lead={null} options={options} currentEmployeeId={currentEmployeeId} storageReady={storageReady} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'edit' && <AddLeadModal mode="edit" lead={dialog.row} options={options} currentEmployeeId={currentEmployeeId} storageReady={storageReady} onClose={() => setDialog(null)} onSaved={afterSave} />}
      {dialog?.kind === 'layout' && abilities.layout && (
        <PageLayoutEditor initialFields={options.fields} columnOrder={options.columnOrder} onClose={changed => { setDialog(null); if (changed) router.refresh(); }} />
      )}
      {dialog?.kind === 'followup' && abilities.edit && (
        <FollowUpModal key={dialog.row.id} row={dialog.row} onClose={() => setDialog(null)} onSaved={() => afterSave(`Follow-up saved for ${dialog.row.code}`)} />
      )}
      {dialog?.kind === 'followups' && <FollowUpFilesModal row={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'close' && abilities.edit && (
        <CloseLeadModal key={dialog.row.id} row={dialog.row} onClose={() => setDialog(null)} onSaved={() => afterSave(`Lead ${dialog.row.code} closed`)} />
      )}
      {dialog?.kind === 'convert' && abilities.convert && (
        <ConvertLeadModal key={dialog.row.id} row={dialog.row} onClose={() => setDialog(null)} onSaved={result => afterSave(`Lead ${dialog.row.code} converted to deal ${result.dealNumber}`)} />
      )}
      {dialog?.kind === 'needFollowUp' && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null); }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="needfu-title" aria-describedby="needfu-text" onKeyDown={e => { if (e.key === 'Escape') setDialog(null); }} className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm">
            <h3 id="needfu-title" className="text-[17px] font-bold text-[#333]">Follow-up needed</h3>
            <p id="needfu-text" className="text-[14px] text-gray-600 mt-2">{FOLLOWUP_NEEDED_MESSAGE}</p>
            <div className="flex justify-end mt-5">
              <button autoFocus onClick={() => setDialog(null)} className="px-5 h-[38px] rounded-md bg-black text-white text-[14px]">OK</button>
            </div>
          </div>
        </div>
      )}
      {dialog?.kind === 'view' && <ViewLeadModal leadId={dialog.row.id} options={options} onClose={() => setDialog(null)} />}
      {!dialog && search.get('view') && <ViewLeadModal key={search.get('view')} leadId={search.get('view')!} options={options} onClose={() => setParams({ view: undefined }, true)} />}
      {dialog?.kind === 'import' && (
        <ImportLeadsModal
          onClose={() => setDialog(null)}
          onImported={afterSave}
        />
      )}

      {(dialog?.kind === 'delete' || dialog?.kind === 'duplicate' || dialog?.kind === 'reopen') && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm">
            <h3 id="confirm-title" className="text-[17px] font-bold text-[#333]">{dialog.kind === 'delete' ? 'Delete lead?' : dialog.kind === 'reopen' ? 'Reopen lead?' : 'Duplicate lead?'}</h3>
            <p className="text-[14px] text-gray-600 mt-2">
              {dialog.kind === 'delete'
                ? <>Lead <b>{dialog.row.code}</b> ({dialog.row.customerName}) will be removed from the list. Its Lead ID is never reused.</>
                : dialog.kind === 'reopen'
                  ? <>Lead <b>{dialog.row.code}</b> ({dialog.row.customerName}) will show as Open again. Why it was closed, and its files, stay in its history.</>
                  : <>A new lead with a new Lead ID will be created from <b>{dialog.row.code}</b>. Files are not copied.</>}
            </p>
            <div className="flex justify-end gap-3 mt-5">
              <button disabled={busy} onClick={() => setDialog(null)} className="px-4 h-[38px] rounded-md bg-gray-200 text-gray-800 text-[14px] disabled:opacity-60">Cancel</button>
              {dialog.kind === 'delete' ? (
                <button disabled={busy} onClick={() => run(() => callApi(`/api/leads/${dialog.row.id}`, 'DELETE').then(() => {}), `Lead ${dialog.row.code} deleted`)} className="px-4 h-[38px] rounded-md bg-[#d9232b] text-white text-[14px] disabled:opacity-60">{busy ? 'Deleting…' : 'Delete'}</button>
              ) : dialog.kind === 'reopen' ? (
                <button disabled={busy} onClick={() => run(() => callApi(`/api/leads/${dialog.row.id}/reopen`, 'POST').then(() => {}), `Lead ${dialog.row.code} reopened`)} className="px-4 h-[38px] rounded-md bg-black text-white text-[14px] disabled:opacity-60">{busy ? 'Reopening…' : 'Reopen'}</button>
              ) : (
                <button disabled={busy} onClick={() => run(async () => { await callApi(`/api/leads/${dialog.row.id}/duplicate`, 'POST'); }, 'Lead duplicated')} className="px-4 h-[38px] rounded-md bg-black text-white text-[14px] disabled:opacity-60">{busy ? 'Duplicating…' : 'Duplicate'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
