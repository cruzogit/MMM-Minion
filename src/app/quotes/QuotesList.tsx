'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Download, FileText, LayoutTemplate, MoreHorizontal, Package, Plus, RefreshCw, Search, Settings, SlidersHorizontal, Trash2, X } from 'lucide-react';
import { callApi } from '@/lib/leads/client';
import type { ModuleLayoutDto } from '@/lib/records/types';
import { formatMoney } from '@/lib/quotes/format';
import { listHeader } from '@/lib/quotes/headers';
import { QUOTE_STATUSES, type DisplaySettings, type QuoteAbilities, type QuoteListData, type QuoteListParams } from '@/lib/quotes/types';
import { useToast } from '@/components/ui/Toast';
import { LayoutEditor } from '../records/layout-editor/LayoutEditor';
import type { DraftListItem } from '@/lib/quotes/draft-server';
import { Button, DateBox, Menu, MenuItem, MenuRule, Modal, StatusText } from './ui';
import InProgress from './InProgress';
import { queryOf } from './urls';

const WIDTH: Record<string, number> = { date: 176, quoteNumber: 204, reference: 381, status: 155, amount: 193, expiryDate: 150 };
const SORTABLE = new Set(['date', 'quoteNumber', 'reference', 'customerId', 'status', 'amount', 'expiryDate']);

export default function QuotesList({ layout, data, params, abilities, display, drafts }: {
  layout: ModuleLayoutDto; data: QuoteListData; params: QuoteListParams; abilities: QuoteAbilities; display: DisplaySettings; drafts: DraftListItem[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [searchOpen, setSearchOpen] = useState(!!params.q);
  const [term, setTerm] = useState(params.q ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [from, setFrom] = useState(params.from ?? '');
  const [to, setTo] = useState(params.to ?? '');
  const searchBox = useRef<HTMLInputElement>(null);

  const go = (patch: Parameters<typeof queryOf>[1]) => router.push(`/quotes${queryOf(params, patch)}`);

  // The search box asks for the list after a short pause
  useEffect(() => {
    if ((term.trim() || '') === (params.q ?? '')) return;
    const t = setTimeout(() => router.replace(`/quotes${queryOf(params, { q: term.trim() || undefined })}`), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);
  useEffect(() => { if (searchOpen) searchBox.current?.focus(); }, [searchOpen]);
  // What was selected belongs to the page that was showing
  const [seenData, setSeenData] = useState(data);
  if (seenData !== data) { setSeenData(data); setSelected(new Set()); }

  const columns = useMemo(() => layout.columns.map(k => layout.fields.find(f => f.key === k)).filter((f): f is NonNullable<typeof f> => !!f), [layout]);
  const headerOf = listHeader;

  const sortKey = params.sort && SORTABLE.has(params.sort) ? params.sort : 'date';
  const sortDir = params.dir ?? 'desc';
  const sortBy = (key: string) => go({ sort: key, dir: sortKey === key && sortDir === 'asc' ? 'desc' : 'asc' });

  const allOnPage = data.rows.length > 0 && data.rows.every(r => selected.has(r.id));
  const someOnPage = data.rows.some(r => selected.has(r.id));
  const toggleAll = () => setSelected(allOnPage ? new Set() : new Set(data.rows.map(r => r.id)));
  const toggleOne = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const views: { label: string; status?: string; count: number }[] = [
    { label: 'All Quotes', count: Object.values(data.statusCounts).reduce((a, b) => a + b, 0) },
    ...QUOTE_STATUSES.map(s => ({ label: s, status: s as string, count: data.statusCounts[s] ?? 0 })),
  ];
  const title = params.status ? `${params.status} Quotes` : 'All Quotes';
  const filtered = !!(params.q || params.status || params.from || params.to || params.customer);

  const deleteSelected = async () => {
    setDeleting(true);
    let done = 0;
    const failed: string[] = [];
    for (const id of selected) {
      try { await callApi(`/api/quotes/${id}`, 'DELETE'); done++; } catch (e) { failed.push(e instanceof Error ? e.message : 'Could not delete'); }
    }
    setDeleting(false);
    setConfirmDelete(false);
    setSelected(new Set());
    if (done) toast.success(`${done} quote${done === 1 ? '' : 's'} deleted`);
    if (failed.length) toast.error(failed[0]);
    router.refresh();
  };

  const first = data.showing === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.showing, data.page * data.pageSize);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Title bar */}
      <div className="h-[55px] pl-[25px] pr-[21px] pb-[11px] flex items-center gap-3 shrink-0">
        {selected.size > 0 ? (
          <div className="flex items-center gap-3">
            <span className="text-[16px] font-semibold">{selected.size} selected</span>
            {abilities.delete && <Button kind="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="w-3.5 h-3.5 text-[#d9232b]" /> Delete</Button>}
            <Button kind="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        ) : (
          <Menu width={230} trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-haspopup="menu" className="flex items-center gap-1.5 text-[18px] font-semibold text-[#222529]">
              {title} <ChevronDown className="w-4 h-4 text-[#548df6] mt-0.5" strokeWidth={3} />
            </button>
          )}>
            {close => (
              <>
                <div className="px-3 py-1 text-[11px] uppercase tracking-wide text-[#6d7189]">Views</div>
                {views.map(v => (
                  <MenuItem key={v.label} onClick={() => { close(); go({ status: v.status }); }}>
                    <span className={`flex-1 ${(params.status ?? undefined) === v.status ? 'font-semibold text-[#548df6]' : ''}`}>{v.label}</span>
                    <span className="text-[11px] text-[#6d7189]">{v.count}</span>
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        )}

        <div className="ml-auto flex items-center gap-[10px]">
          {searchOpen ? (
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#9ca0ab] absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                ref={searchBox}
                value={term}
                onChange={e => setTerm(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setTerm(''); setSearchOpen(false); } }}
                placeholder="Search quotes"
                aria-label="Search quotes"
                className="w-[240px] h-[30px] pl-8 pr-7 text-[12.5px] border border-[#d7d5e1] rounded-[4px] focus:outline-none focus:border-[#548df6]"
              />
              <button type="button" aria-label="Close search" onClick={() => { setTerm(''); setSearchOpen(false); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#9ca0ab] hover:text-[#22263b]"><X className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              aria-label="Search quotes"
              title="Search quotes"
              className="w-[32px] h-[32px] flex items-center justify-center rounded-[4px] border border-[#d7d5e1] hover:bg-[#f1f1fa] text-[#575a6f]"
            >
              <Search className="w-4 h-4" />
            </button>
          )}
          {abilities.create && (
            <Link href="/quotes/new" className="inline-flex items-center gap-[6px] h-[32px] px-[10px] rounded-[4px] bg-[#548df6] hover:bg-[#4a82ea] text-white text-[13px] font-medium"><Plus className="w-[13px] h-[13px]" strokeWidth={2.5} /> New</Link>
          )}
          <Menu align="right" width={230} trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="More" aria-haspopup="menu" className="w-[32px] h-[32px] flex items-center justify-center rounded-[4px] border border-[#d7d5e1] hover:bg-[#f1f1fa]"><MoreHorizontal className="w-4 h-4" /></button>
          )}>
            {close => (
              <>
                {abilities.export && <a href={`/api/quotes/export${queryOf(params, {})}`} onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]"><span className="w-4 flex justify-center text-[#6d7189]"><Download className="w-3.5 h-3.5" /></span> Export quotes (CSV)</a>}
                <Link href="/items" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]"><span className="w-4 flex justify-center text-[#6d7189]"><Package className="w-3.5 h-3.5" /></span> Items</Link>
                <MenuRule />
                <Link href="/quotes/settings" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]"><span className="w-4 flex justify-center text-[#6d7189]"><Settings className="w-3.5 h-3.5" /></span> Quote Settings</Link>
                {abilities.layout && <MenuItem icon={<LayoutTemplate className="w-3.5 h-3.5" />} onClick={() => { close(); setLayoutOpen(true); }}>Edit Page Layout</MenuItem>}
                <MenuRule />
                <MenuItem icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => { close(); router.refresh(); }}>Refresh</MenuItem>
              </>
            )}
          </Menu>
        </div>
      </div>

      {abilities.create && <InProgress drafts={drafts} />}

      {/* Table */}
      <div className="flex-1 overflow-x-auto q-scroll">
        <table className="w-full min-w-[980px] border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="h-[36px] bg-[#f9f9fb] border-y border-[#ebeaf2] text-[11px] font-medium uppercase text-[#6d7189]">
              <th className="w-[59px] pl-[17px] text-left align-middle">
                <div className="flex items-center gap-[10px]">
                  <Menu width={290} trigger={({ toggle }) => (
                    <button type="button" onClick={toggle} aria-label="Filter" aria-haspopup="menu" className={`w-[14px] h-[14px] flex items-center justify-center ${params.from || params.to ? 'text-[#548df6]' : 'text-[#548df6]'}`}><SlidersHorizontal className="w-[14px] h-[14px]" /></button>
                  )}>
                    {close => (
                      <div className="px-3 py-2 normal-case tracking-normal text-[12px]">
                        <div className="font-semibold mb-2">Filter by date</div>
                        <label className="block mb-1 text-[#6d7189]" htmlFor="flt-from">From</label>
                        <DateBox id="flt-from" value={from} onChange={setFrom} />
                        <label className="block mt-2 mb-1 text-[#6d7189]" htmlFor="flt-to">To</label>
                        <DateBox id="flt-to" value={to} onChange={setTo} />
                        <div className="flex justify-end gap-2 mt-3">
                          <Button onClick={() => { setFrom(''); setTo(''); close(); go({ from: undefined, to: undefined }); }}>Clear</Button>
                          <Button kind="blue" onClick={() => { close(); go({ from: from || undefined, to: to || undefined }); }}>Apply</Button>
                        </div>
                      </div>
                    )}
                  </Menu>
                  <input type="checkbox" className="q-check" checked={allOnPage} ref={el => { if (el) el.indeterminate = !allOnPage && someOnPage; }} onChange={toggleAll} aria-label="Select all quotes on this page" />
                </div>
              </th>
              {columns.map(f => {
                const sortable = SORTABLE.has(f.key);
                const on = sortKey === f.key;
                const right = f.key === 'amount';
                return (
                  <th key={f.key} style={f.key === 'customerId' ? undefined : { width: WIDTH[f.key] ?? 150 }} className={`${f.key === 'date' ? 'pl-[17px] pr-[15px]' : 'px-[15px]'} font-medium ${right ? 'text-right' : 'text-left'}`} aria-sort={on ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortable ? (
                      <button type="button" onClick={() => sortBy(f.key)} className={`group inline-flex items-center gap-1 uppercase ${right ? 'flex-row-reverse' : ''}`}>
                        {headerOf(f.key, f.label)}
                        {on ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ChevronsUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
                      </button>
                    ) : headerOf(f.key, f.label)}
                  </th>
                );
              })}
              <th className="w-[87px] pr-[48px] text-right">
                <button type="button" aria-label="Search" onClick={() => setSearchOpen(o => !o)} className="text-[#6d7189] hover:text-[#22263b]"><Search className="w-3.5 h-3.5" /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map(r => (
              <tr key={r.id} data-quote-row={r.id} onClick={e => { if (!(e.target as HTMLElement).closest('a,button,input,label')) router.push(`/quotes/${r.id}`); }} className={`h-[46px] border-b border-[#ebeaf2] text-[13px] text-black cursor-pointer hover:bg-[#fafafc] ${selected.has(r.id) ? 'bg-[#f1f1fa]' : ''}`}>
                <td className="pl-[39px]"><input type="checkbox" className="q-check" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.number}`} /></td>
                {columns.map(f => {
                  const v = r.cells[f.key] ?? '';
                  if (f.key === 'quoteNumber') return <td key={f.key} className="px-[15px] whitespace-nowrap"><Link href={`/quotes/${r.id}`} className="text-[#355bd4] hover:underline">{v}</Link></td>;
                  if (f.key === 'status') return <td key={f.key} className="px-[15px]"><StatusText status={v} /></td>;
                  if (f.key === 'amount') return <td key={f.key} className="px-[15px] text-right whitespace-nowrap">{formatMoney(Number(v) || 0, display.currencySymbol, display.grouping)}</td>;
                  return <td key={f.key} className={`${f.key === 'date' ? 'pl-[17px] pr-[15px]' : 'px-[15px]'} truncate`} title={v}>{v}</td>;
                })}
                <td />
              </tr>
            ))}
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 2} className="py-16 text-center text-[#6d7189]">
                  <FileText className="w-8 h-8 mx-auto text-[#c9cbd6] mb-2" aria-hidden />
                  <p className="text-[14px]">{filtered ? 'No quotes match.' : 'There are no quotes yet.'}</p>
                  {filtered ? (
                    <Link href="/quotes" className="inline-block mt-2 text-[13px] text-[#548df6] hover:underline">Show all quotes</Link>
                  ) : abilities.create ? (
                    <Link href="/quotes/new" className="inline-block mt-2 text-[13px] text-[#548df6] hover:underline">Create the first quote</Link>
                  ) : null}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pager */}
      <div className="h-[44px] px-[25px] flex items-center justify-between text-[12px] text-[#6d7189] border-t border-[#ebeaf2] bg-white shrink-0">
        <span>{data.showing === 0 ? 'No quotes' : `${first}–${last} of ${data.showing}`}{filtered && data.showing !== data.total ? ` (${data.total} in all)` : ''}</span>
        <div className="flex items-center gap-1">
          <button type="button" disabled={data.page <= 1} onClick={() => go({ page: data.page - 1 })} aria-label="Previous page" className="w-7 h-7 flex items-center justify-center rounded border border-[#d7d5e1] hover:bg-[#f1f1fa] disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
          <span className="px-2">Page {data.page} of {data.pageCount}</span>
          <button type="button" disabled={data.page >= data.pageCount} onClick={() => go({ page: data.page + 1 })} aria-label="Next page" className="w-7 h-7 flex items-center justify-center rounded border border-[#d7d5e1] hover:bg-[#f1f1fa] disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
        </div>
      </div>

      {layoutOpen && <LayoutEditor moduleId="quote" initial={layout} onClose={changed => { setLayoutOpen(false); if (changed) router.refresh(); }} />}
      {confirmDelete && (
        <Modal title="Delete quotes?" onClose={() => !deleting && setConfirmDelete(false)} busy={deleting} width={440} footer={(
          <>
            <Button onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
            <Button kind="danger" onClick={deleteSelected} busy={deleting}>Delete {selected.size}</Button>
          </>
        )}>
          <p className="text-[13px]">{selected.size === 1 ? 'This quote' : `These ${selected.size} quotes`} will be removed from the list. The quote number{selected.size === 1 ? '' : 's'} will not be used again. An invoiced quote cannot be deleted.</p>
        </Modal>
      )}
    </div>
  );
}
