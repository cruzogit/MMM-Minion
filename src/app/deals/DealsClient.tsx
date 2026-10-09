'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { STATUS_FILTER_ITEMS, type ColumnFilterKey, type DealColumnId, type LeadFormOptions } from '@/lib/leads/constants';
import type { LeadFieldDto } from '@/lib/leads/layout-shared';
import { callApi } from '@/lib/leads/client';
import { CONVERTED_FILTER, DEAL_DATE_FILTER_TYPES, DEAL_FILTERS, type DealFilterId, type DealSortKey } from '@/lib/deals/constants';
import type { DealListParams, DealRow } from '@/lib/deals/queries';
import { useToast } from '@/components/ui/Toast';
import LeadHeader from '@/app/leads/components/LeadHeader';
import LeadToolbar from '@/app/leads/components/LeadToolbar';
import LeadSummary from '@/app/leads/components/LeadSummary';
import LeadSearch from '@/app/leads/components/LeadSearch';
import LeadFilters from '@/app/leads/components/LeadFilters';
import AddLeadModal from '@/app/leads/components/AddLeadModal';
import ViewLeadModal from '@/app/leads/components/ViewLeadModal';
import FollowUpModal from '@/app/leads/components/FollowUpModal';
import FollowUpFilesModal from '@/app/leads/components/FollowUpFilesModal';
import CloseLeadModal from '@/app/leads/components/CloseLeadModal';
import DealTable from './components/DealTable';
import DealLayoutEditor from './components/DealLayoutEditor';
import ConvertProjectModal, { type ConvertField } from './components/ConvertProjectModal';
import ImportDealsModal from './components/ImportDealsModal';

type Data = {
  rows: DealRow[];
  summary: { total: number; showing: number };
  page: number;
  pageCount: number;
  pageSize: number;
};

type Dialog = { kind: 'edit'; row: DealRow } | { kind: 'view'; row: DealRow } | { kind: 'delete'; row: DealRow } | { kind: 'duplicate'; row: DealRow } | { kind: 'revive'; row: DealRow } | { kind: 'layout' } | { kind: 'followup'; row: DealRow } | { kind: 'followups'; row: DealRow } | { kind: 'close'; row: DealRow } | { kind: 'project'; row: DealRow } | { kind: 'import' } | null;

// The Leads page, for the deals: the same layout and behaviour (live search, quick filters, header sort / filter menus, dates, paging in the
// address, reset, download), with Convert to Project (the icon) and View, Edit, Close Deal, Duplicate and Delete (the three dots) in Actions.
// The Converted Deals filter shows the deals that became projects; every other view leaves them out.
export default function DealsClient({ data, params, options, lists, columnOrder, statusField, currentEmployeeId, abilities, storageReady, convertFields }: {
  data: Data;
  params: DealListParams;
  options: LeadFormOptions;
  lists: { customerNames: string[]; requirements: string[]; locations: string[] };
  columnOrder: DealColumnId[];
  statusField: LeadFieldDto | null; // the Deal Status list's editor row (Super Admin only)
  currentEmployeeId: string | null;
  abilities: { edit: boolean; create: boolean; delete: boolean; export: boolean; layout: boolean; project: boolean };
  storageReady: boolean;
  convertFields: ConvertField[]; // the Convert to Project popup's fields, from the Project layout
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
    startTransition(() => (replace ? router.replace : router.push)(`/deals${next.toString() ? `?${next}` : ''}`));
  };

  // Live search: results update about 0.15s after each keystroke
  useEffect(() => {
    if (resetting.current || (params.q ?? '') === q.trim()) return;
    const t = setTimeout(() => setParams({ q: q.trim() || undefined }, true), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const exportHref = `/api/deals/export${search.toString() ? `?${search}` : ''}`;

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

  const handlersFor = (row: DealRow) => ({
    onView: () => setDialog({ kind: 'view', row }),
    onEdit: () => setDialog({ kind: 'edit', row }),
    onConvertToProject: () => setDialog({ kind: 'project', row }),
    onCloseDeal: () => setDialog({ kind: 'close', row }),
    onRevive: () => setDialog({ kind: 'revive', row }),
    onDuplicate: () => setDialog({ kind: 'duplicate', row }),
    onDelete: () => setDialog({ kind: 'delete', row }),
  });

  const group = (key: ColumnFilterKey, label: string, items: { value: string; label: string }[]) => ({ key, label, items, selected: params.cols?.[key] ?? [] });
  const people = options.employees.map(e => ({ value: e.id, label: e.name }));
  const filterGroups = {
    customer: [group('customer', 'Customer details', lists.customerNames.map(n => ({ value: n, label: n })))],
    requirement: [group('requirement', 'Requirements', lists.requirements.map(t => ({ value: t, label: t })))],
    assigned: [group('leadPerson', 'Lead Person', people), group('assigned', 'Task Assigned Person', people)],
    status: [group('status', 'Deal Status', options.dealStatuses.map(o => ({ value: o.id, label: o.label })))],
    state: [group('state', 'Status', STATUS_FILTER_ITEMS.map(o => ({ value: o.value, label: o.label })))],
    source: [group('source', 'Source', options.sources.map(o => ({ value: o.id, label: o.label })))],
    category: [group('category', 'Categories', options.mainCategories.map(o => ({ value: o.id, label: o.label })))],
    location: [group('location', 'Location', lists.locations.map(l => ({ value: l, label: l })))],
  };

  const onFilter = (next: Partial<Record<ColumnFilterKey, string[]>>) =>
    setParams(Object.fromEntries(Object.entries(next).map(([k, v]) => [`f_${k}`, v && v.length ? JSON.stringify(v) : undefined])));

  // Click on the Total Deals number: show every deal. The search, quick filters, column filters and dates are dropped (the sorting stays).
  const showAll = () => {
    resetting.current = true;
    setQ('');
    const next = new URLSearchParams();
    for (const k of ['sort', 'dir']) { const v = search.get(k); if (v) next.set(k, v); }
    startTransition(() => { router.push(`/deals${next.toString() ? `?${next}` : ''}`); router.refresh(); });
  };

  // Clears the search, every filter and the sorting, then reloads the list
  const clearAll = () => {
    resetting.current = true;
    setQ('');
    startTransition(() => { router.push('/deals'); router.refresh(); });
  };
  useEffect(() => { resetting.current = false; }, [data]);

  const required = (key: string) => !!options.fields.find(f => f.key === key)?.required;

  return (
    <div data-light-native className="w-full min-h-screen bg-white text-[#333] font-sans">
      <div className="px-4 sm:px-5 pt-6 pb-10 max-w-[2000px] mx-auto">
        <LeadHeader title="Deal Management" />

        <div className="mt-6 flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-x-5 gap-y-3 pb-5 border-b-[3px] border-gray-200">
          <LeadSummary noun="Deals" total={data.summary.total} showing={data.summary.showing} onShowAll={showAll} />
          <LeadSearch value={q} onChange={setQ} placeholder="Search deals..." />
          <LeadFilters active={params.filter} filters={DEAL_FILTERS} onChange={(id: DealFilterId | undefined) => setParams({ filter: id })} />
          <LeadToolbar
            className="self-end lg:self-auto lg:ml-auto"
            params={params}
            canCreate={false}
            canExport={abilities.export}
            canEditLayout={abilities.layout && !!statusField}
            refreshing={pending}
            onAdd={() => {}}
            onEditLayout={() => setDialog({ kind: 'layout' })}
            onRefresh={clearAll}
            onParams={setParams}
            exportHref={exportHref}
            dateTypes={DEAL_DATE_FILTER_TYPES}
            layoutLabel="Edit Deal Layout"
            noun="deals"
            canImport={abilities.create}
            onImport={() => setDialog({ kind: 'import' })}
            showImport={true}
          />
        </div>

        <div className="mt-4">
          <DealTable
            rows={data.rows}
            totalDeals={data.summary.total}
            convertedView={params.filter === CONVERTED_FILTER}
            sort={params.sort}
            dir={params.dir === 'asc' ? 'asc' : 'desc'}
            abilities={abilities}
            loading={pending}
            columnOrder={columnOrder}
            filterGroups={filterGroups}
            onFilter={onFilter}
            onSort={(k: DealSortKey, d) => setParams({ sort: k, dir: d })}
            onReset={clearAll}
            onFollowUp={row => setDialog({ kind: 'followup', row })}
            onViewFollowUps={row => setDialog({ kind: 'followups', row })}
            inline={{
              leadStatuses: options.dealStatuses,
              required: { amount: true, leadStatusId: false, location: required('location'), exactLocation: required('exactLocation') },
              onSaved: () => router.refresh(),
              apiBase: '/api/deals',
              statusNoun: 'Deal',
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

      {dialog?.kind === 'edit' && abilities.edit && (
        <AddLeadModal mode="edit" deal lead={dialog.row} options={options} currentEmployeeId={currentEmployeeId} storageReady={storageReady} onClose={() => setDialog(null)} onSaved={afterSave} />
      )}
      {dialog?.kind === 'layout' && abilities.layout && statusField && (
        <DealLayoutEditor statusField={statusField} columnOrder={columnOrder} onClose={() => { setDialog(null); router.refresh(); }} />
      )}
      {dialog?.kind === 'followup' && abilities.edit && (
        <FollowUpModal key={dialog.row.id} row={dialog.row} apiBase="/api/deals" noun="Deal" onClose={() => setDialog(null)} onSaved={() => afterSave(`Follow-up saved for ${dialog.row.code}`)} />
      )}
      {dialog?.kind === 'followups' && <FollowUpFilesModal row={dialog.row} apiBase="/api/deals" noun="Deal" onClose={() => setDialog(null)} />}
      {dialog?.kind === 'close' && abilities.edit && (
        <CloseLeadModal key={dialog.row.id} row={dialog.row} apiBase="/api/deals" noun="Deal" onClose={() => setDialog(null)} onSaved={() => afterSave(`Deal ${dialog.row.code} closed`)} />
      )}
      {dialog?.kind === 'project' && abilities.project && (
        <ConvertProjectModal key={dialog.row.id} row={dialog.row} fields={convertFields} onClose={() => setDialog(null)} onSaved={r => afterSave(`Deal ${r.dealNumber} converted to project ${r.code}`)} />
      )}
      {dialog?.kind === 'view' && <ViewLeadModal key={dialog.row.id} leadId={dialog.row.leadId} endpoint={`/api/deals/${dialog.row.id}`} title={`Deal ${dialog.row.code}`} options={options} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && (
        <ImportDealsModal
          onClose={() => setDialog(null)}
          onImported={afterSave}
        />
      )}

      {(dialog?.kind === 'delete' || dialog?.kind === 'duplicate' || dialog?.kind === 'revive') && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm">
            <h3 id="confirm-title" className="text-[17px] font-bold text-[#333]">{dialog.kind === 'delete' ? 'Delete deal?' : dialog.kind === 'revive' ? 'Revive deal?' : 'Duplicate deal?'}</h3>
            <p className="text-[14px] text-gray-600 mt-2">
              {dialog.kind === 'delete'
                ? <>Deal <b>{dialog.row.code}</b> ({dialog.row.deal.name}) and the lead behind it (<b>{dialog.row.leadCode}</b>) will be removed from the lists. Their IDs are never reused.</>
                : dialog.kind === 'revive'
                  ? <>Deal <b>{dialog.row.code}</b> ({dialog.row.deal.name}) will show as Open again. Why it was closed, and its files, stay in its history.</>
                  : <>A new deal with a new Deal ID (and a new Lead ID behind it) will be created from <b>{dialog.row.code}</b>. Files and follow-ups are not copied.</>}
            </p>
            <div className="flex justify-end gap-3 mt-5">
              <button disabled={busy} onClick={() => setDialog(null)} className="px-4 h-[38px] rounded-md bg-gray-200 text-gray-800 text-[14px] disabled:opacity-60">Cancel</button>
              {dialog.kind === 'delete' ? (
                <button disabled={busy} onClick={() => run(() => callApi(`/api/deals/${dialog.row.id}`, 'DELETE').then(() => {}), `Deal ${dialog.row.code} deleted`)} className="px-4 h-[38px] rounded-md bg-[#d9232b] text-white text-[14px] disabled:opacity-60">{busy ? 'Deleting…' : 'Delete'}</button>
              ) : dialog.kind === 'revive' ? (
                <button disabled={busy} onClick={() => run(() => callApi(`/api/deals/${dialog.row.id}/reopen`, 'POST').then(() => {}), `Deal ${dialog.row.code} revived`)} className="px-4 h-[38px] rounded-md bg-black text-white text-[14px] disabled:opacity-60">{busy ? 'Reviving…' : 'Revive'}</button>
              ) : (
                <button disabled={busy} onClick={() => run(async () => { await callApi(`/api/deals/${dialog.row.id}/duplicate`, 'POST'); }, `Deal duplicated from ${dialog.row.code}`)} className="px-4 h-[38px] rounded-md bg-black text-white text-[14px] disabled:opacity-60">{busy ? 'Duplicating…' : 'Duplicate'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
