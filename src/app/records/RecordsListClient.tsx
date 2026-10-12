'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, RefreshCw, Upload } from 'lucide-react';
import { ApiError, callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import { MODULES } from '@/lib/records/registry';
import { NOT_YET_APPROVED } from '@/lib/records/registry';
import { isFilterable, isSortable } from '@/lib/records/values';
import type { Abilities, LayoutField, ListData, ListParams, LookupItem, ModuleId, ModuleLayoutDto } from '@/lib/records/types';
import LeadHeader from '@/app/leads/components/LeadHeader';
import LeadSummary from '@/app/leads/components/LeadSummary';
import LeadSearch from '@/app/leads/components/LeadSearch';
import HeaderCell, { type FilterGroup, type HeaderColumn } from '@/app/leads/components/HeaderCell';
import LightConfirm from '@/app/leads/components/LightConfirm';
import { LayoutButton } from './layout-editor/LayoutEditor';
import RecordActions from './components/RecordActions';
import ImportRecordsModal from './components/ImportRecordsModal';
import { api } from './client';

// Column widths: the class names are written out in full so Tailwind finds them
const WIDTH: Record<string, { px: number; cls: string }> = {
  TEXT: { px: 200, cls: 'w-[200px]' }, TEXTAREA: { px: 260, cls: 'w-[260px]' }, DROPDOWN: { px: 165, cls: 'w-[165px]' }, USER: { px: 175, cls: 'w-[175px]' },
  APPROVER: { px: 175, cls: 'w-[175px]' }, LOOKUP: { px: 230, cls: 'w-[230px]' }, CURRENCY: { px: 150, cls: 'w-[150px]' }, NUMBER: { px: 120, cls: 'w-[120px]' },
  DATE: { px: 130, cls: 'w-[130px]' }, DATETIME: { px: 170, cls: 'w-[170px]' }, EMAIL: { px: 230, cls: 'w-[230px]' }, PHONE: { px: 150, cls: 'w-[150px]' },
  URL: { px: 220, cls: 'w-[220px]' }, CHECKBOX: { px: 100, cls: 'w-[100px]' }, FILE: { px: 160, cls: 'w-[160px]' },
};
const FALLBACK = { px: 180, cls: 'w-[180px]' };
const ID_WIDTH = 160;
const ACTIONS_WIDTH = 110;
const iconBtn = 'w-10 h-10 flex items-center justify-center text-gray-800 hover:text-black hover:bg-gray-100 rounded transition-colors';

type Deleting = { id: string; code: string; warning: string | null } | null;

// The list page of a record module: the same layout as the Leads page (title, totals, live search, header sort / filter menus,
// reset in Actions, download, paging in the address) with the columns of the module's Edit Page Layout.
export default function RecordsListClient({ moduleId, layout, data, params, abilities, users }: {
  moduleId: ModuleId;
  layout: ModuleLayoutDto;
  data: ListData;
  params: ListParams;
  abilities: Abilities;
  users: LookupItem[];
}) {
  const def = MODULES[moduleId];
  const base = `/${def.slug}`;
  const router = useRouter();
  const search = useSearchParams();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(params.q ?? '');
  const [deleting, setDeleting] = useState<Deleting>(null);
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // While a reset is on its way, the search box's own delayed update must not put the old search back in the address
  const resetting = useRef(false);

  const setParams = (updates: Record<string, string | undefined>, replace = false) => {
    const next = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!('page' in updates)) next.delete('page');
    startTransition(() => (replace ? router.replace : router.push)(`${base}${next.toString() ? `?${next}` : ''}`));
  };

  // Live search: results update about 0.15s after each keystroke
  useEffect(() => {
    if (resetting.current || (params.q ?? '') === q.trim()) return;
    const t = setTimeout(() => setParams({ q: q.trim() || undefined }, true), 150);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => { resetting.current = false; }, [data]);

  const exportHref = `/api/records/${def.slug}/export${search.toString() ? `?${search}` : ''}`;

  const showAll = () => {
    resetting.current = true;
    setQ('');
    const next = new URLSearchParams();
    for (const k of ['sort', 'dir']) { const v = search.get(k); if (v) next.set(k, v); }
    startTransition(() => { router.push(`${base}${next.toString() ? `?${next}` : ''}`); router.refresh(); });
  };
  const clearAll = () => {
    resetting.current = true;
    setQ('');
    startTransition(() => { router.push(base); router.refresh(); });
  };

  // ---- columns
  const idField = layout.fields.find(f => f.type === 'AUTO');
  const idLabel = idField?.label ?? def.idLabel;
  const fields = layout.columns.map(k => layout.fields.find(f => f.key === k)).filter((f): f is LayoutField => !!f);
  const noneItem = { value: 'none', label: '(Empty)' };
  const filterGroups: Record<string, FilterGroup[]> = {};
  const columns: (HeaderColumn & { id: string; field?: LayoutField })[] = [
    { id: 'code', label: idLabel, sort: 'code', width: 'w-[160px]' },
    ...fields.map(f => {
      if (isFilterable(f)) {
        const items = f.type === 'DROPDOWN' ? f.options.map(o => ({ value: o.id, label: o.label })) : users.map(u => ({ value: u.id, label: u.label }));
        filterGroups[f.key] = [{ key: f.key, label: f.label, items: f.isSystem ? [noneItem, ...items] : items, selected: params.filters[f.key] ?? [] }];
      }
      return { id: f.key, field: f, label: f.label, sort: isSortable(f) ? f.key : undefined, filter: isFilterable(f) ? f.key : undefined, width: (WIDTH[f.type] ?? FALLBACK).cls };
    }),
    { id: 'actions', label: 'Actions', width: 'w-[110px]' },
  ];
  const minWidth = ID_WIDTH + ACTIONS_WIDTH + fields.reduce((n, f) => n + (WIDTH[f.type] ?? FALLBACK).px, 0);
  const activeSort = params.sort ?? 'code';
  const dir = params.dir ?? 'desc';

  const onFilter = (next: Partial<Record<string, string[]>>) =>
    setParams(Object.fromEntries(Object.entries(next).map(([k, v]) => [`f_${k}`, v && v.length ? JSON.stringify(v) : undefined])));

  const handlersFor = (id: string) => ({
    onView: () => router.push(`${base}/${id}`),
    onEdit: () => router.push(`${base}/${id}/edit`),
    onDelete: () => { const row = data.rows.find(r => r.id === id)!; setDeleting({ id, code: row.code, warning: null }); },
  });

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await callApi(api(def.slug, `/${deleting.id}`), 'DELETE', deleting.warning ? { confirm: true } : {});
      toast.success(`${deleting.code} deleted`);
      setDeleting(null);
      router.refresh();
    } catch (e) {
      if (!deleting.warning && e instanceof ApiError && e.status === 409) setDeleting({ ...deleting, warning: e.message });
      else { toast.error(e instanceof Error ? e.message : 'Could not delete'); setDeleting(null); }
    } finally {
      setBusy(false);
    }
  };

  const cellText = (f: LayoutField, text: string) => {
    if (f.type === 'APPROVER') return text === NOT_YET_APPROVED ? <span className="text-gray-400 italic">{text}</span> : <span>{text}</span>;
    return text ? <span>{text}</span> : <span className="text-gray-300">—</span>;
  };

  return (
    <div data-light-native className="w-full min-h-screen bg-white text-[#333] font-sans">
      <div className="px-4 sm:px-5 pt-6 pb-10 max-w-[2000px] mx-auto">
        <div className="flex flex-wrap items-center gap-3">
          <LeadHeader title={def.heading} />
          {abilities.create && (
            <Link href={`${base}/new`} className="ml-auto inline-flex items-center gap-2 px-4 h-[42px] rounded-md bg-[#f5b800] hover:bg-[#e0a800] text-black text-[14px] font-semibold">
              <Plus className="w-5 h-5" strokeWidth={2.5} /> {def.createLabel}
            </Link>
          )}
        </div>

        <div className="mt-6 flex flex-col lg:flex-row lg:flex-wrap lg:items-center gap-x-5 gap-y-3 pb-5 border-b-[3px] border-gray-200">
          <LeadSummary noun={def.plural} total={data.total} showing={data.showing} onShowAll={showAll} />
          <LeadSearch value={q} onChange={setQ} placeholder={`Search ${def.plural.toLowerCase()}...`} />
          <div className="flex items-center gap-1 sm:gap-2 self-end lg:self-auto lg:ml-auto">
            {abilities.layout && <LayoutButton moduleId={moduleId} layout={layout} />}
            <button onClick={clearAll} title="Refresh" aria-label="Refresh" className={iconBtn}><RefreshCw className={`w-5 h-5 ${pending ? 'animate-spin' : ''}`} /></button>
            {abilities.export ? (
              <a href={exportHref} title="Download CSV" aria-label="Download CSV" className={iconBtn}><Download className="w-5 h-5" /></a>
            ) : (
              <span className={`${iconBtn} opacity-30 cursor-not-allowed`} title="You do not have permission to export"><Download className="w-5 h-5" /></span>
            )}
            {(moduleId === 'prePayment' || moduleId === 'paymentCollection') && (
              abilities.create ? (
                <button
                  type="button"
                  onClick={() => setShowImport(true)}
                  title={`Import ${def.label} Records (CSV / XLSX)`}
                  aria-label={`Import ${def.label} Records`}
                  className={iconBtn}
                >
                  <Upload className="w-5 h-5" />
                </button>
              ) : (
                <span
                  className={`${iconBtn} opacity-30 cursor-not-allowed`}
                  title={`You do not have permission to import ${def.plural.toLowerCase()}`}
                  aria-disabled="true"
                >
                  <Upload className="w-5 h-5" />
                </span>
              )
            )}
          </div>
        </div>

        <div className="mt-4">
          {data.total === 0 ? (
            <div className="py-20 text-center text-gray-500 border border-dashed border-gray-300 rounded-lg">
              <div className="text-[16px] font-semibold text-gray-700">No {def.plural.toLowerCase()} yet</div>
              <div className="text-[13px] mt-1">{abilities.create ? `Click “${def.createLabel}” to add the first one.` : 'Nothing has been added yet.'}</div>
            </div>
          ) : (
            <div className={pending ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
              {/* Desktop table */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth }}>
                  <thead className="bg-[#f3f4f6]">
                    <tr>
                      {columns.map(c => (
                        <HeaderCell key={c.id} col={c} active={!!c.sort && c.sort === activeSort} dir={dir} groups={filterGroups[c.filter ?? ''] ?? []} onSort={(k, d) => setParams({ sort: k, dir: d })} onFilter={onFilter} onReset={clearAll} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.length === 0 && (
                      <tr><td colSpan={columns.length} className="py-16 text-center text-gray-500"><div className="text-[16px] font-semibold text-gray-700">No {def.plural.toLowerCase()} match this search</div><div className="text-[13px] mt-1">Change the search or the column filters, or use the reset button in Actions.</div></td></tr>
                    )}
                    {data.rows.map(row => (
                      <tr key={row.id} className="border-b border-gray-200 align-middle hover:bg-[#fafafa]" data-record={row.code}>
                        <td className="px-3 py-2.5 align-middle"><Link href={`${base}/${row.id}`} className="font-semibold text-[#1a56c4] hover:underline">{row.code}</Link></td>
                        {fields.map(f => (
                          <td key={f.key} className="px-3 py-2.5 align-middle text-[14px] text-gray-800"><div className="max-w-[300px] truncate" title={row.cells[f.key]}>{cellText(f, row.cells[f.key] ?? '')}</div></td>
                        ))}
                        <td className="px-3 py-2.5 align-middle sticky right-0 z-10 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]">
                          <RecordActions canEdit={abilities.edit} canDelete={abilities.delete} handlers={handlersFor(row.id)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tablet / phone cards */}
              <div className="lg:hidden space-y-4">
                {data.rows.length === 0 && <div className="py-12 text-center text-gray-500 border border-dashed border-gray-300 rounded-lg"><div className="text-[16px] font-semibold text-gray-700">No {def.plural.toLowerCase()} match this search</div></div>}
                {data.rows.map(row => (
                  <article key={row.id} className="border border-gray-200 rounded-lg p-4 space-y-3 bg-white shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">{idLabel}</div>
                        <Link href={`${base}/${row.id}`} className="font-semibold text-[#1a56c4] hover:underline">{row.code}</Link>
                      </div>
                      <RecordActions canEdit={abilities.edit} canDelete={abilities.delete} handlers={handlersFor(row.id)} />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {fields.map(f => (
                        <div key={f.key} className="min-w-0">
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-0.5">{f.label}</div>
                          <div className="text-[14px] text-gray-800 break-words">{cellText(f, row.cells[f.key] ?? '')}</div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </div>

        {data.pageCount > 1 && (
          <div className="mt-5 flex items-center justify-end gap-3 text-[13px] text-gray-600">
            {pending && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>Page {data.page} of {data.pageCount} · {data.pageSize} per page</span>
            <button disabled={data.page <= 1} onClick={() => setParams({ page: String(data.page - 1) })} aria-label="Previous page" className="w-9 h-9 border border-gray-300 rounded flex items-center justify-center disabled:opacity-40 hover:bg-gray-100"><ChevronLeft className="w-4 h-4" /></button>
            <button disabled={data.page >= data.pageCount} onClick={() => setParams({ page: String(data.page + 1) })} aria-label="Next page" className="w-9 h-9 border border-gray-300 rounded flex items-center justify-center disabled:opacity-40 hover:bg-gray-100"><ChevronRight className="w-4 h-4" /></button>
          </div>
        )}
      </div>

      {deleting && (
        <LightConfirm title={deleting.warning ? 'In use' : `Delete ${def.label.toLowerCase()}?`} confirmLabel={deleting.warning ? 'Delete anyway' : 'Delete'} danger busy={busy} onCancel={() => setDeleting(null)} onConfirm={confirmDelete}>
          {deleting.warning ? (
            <>
              <p>{deleting.warning}</p>
              <p className="text-gray-500">Those records keep showing it, but it will no longer be offered when adding new ones. Are you sure you want to continue?</p>
            </>
          ) : (
            <p><b>{deleting.code}</b> will be removed from the list. Its ID is never used again.</p>
          )}
        </LightConfirm>
      )}

      {showImport && (
        <ImportRecordsModal
          moduleId={moduleId}
          onClose={() => setShowImport(false)}
          onImported={(msg) => {
            setShowImport(false);
            toast.success(msg);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
