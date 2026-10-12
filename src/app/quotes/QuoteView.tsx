'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { createPortal, flushSync } from 'react-dom';
import Link, { useLinkStatus } from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { CheckCircle2, ChevronDown, Copy, FileText, LayoutTemplate, Mail, MessageSquare, MoreHorizontal, Paperclip, Pencil, Plus, Printer, Repeat2, Search, Send, Settings, Share2, Trash2, X, XCircle } from 'lucide-react';
import { callApi } from '@/lib/leads/client';
import { formatBytes } from '@/lib/leads/image-optimize';
import { useToast } from '@/components/ui/Toast';
import type { ModuleLayoutDto } from '@/lib/records/types';
import type { QuoteDoc } from '@/lib/quotes/doc';
import { quotePdfName } from '@/lib/quotes/file-name';
import { formatMoney, formatQuoteDay } from '@/lib/quotes/format';
import { QUOTE_STATUSES, STATUS_ACTIONS, type ShareInfo, type ActivityDto, type QuoteAbilities, type QuoteDto, type QuoteListData, type QuoteListParams, type QuoteSettings, type QuoteStatus } from '@/lib/quotes/types';
import { LayoutEditor } from '../records/layout-editor/LayoutEditor';
import QuoteDocument from './QuoteDocument';
import FitWidth from './FitWidth';
import QuoteDetails from './QuoteDetails';
import StatusBand from './StatusBand';
import { NumberingModal } from './modals';
import { SendModal, ShareModal } from './QuoteDialogs';
import { Button, Menu, MenuItem, MenuRule, Modal, Spinner, StatusText } from './ui';
import { queryOf } from './urls';

const CONVERT = [{ id: 'invoice', label: 'Convert to Invoice' }, { id: 'salesOrder', label: 'Convert to Sales Order' }];
const STATUS_ICON: Record<string, React.ReactNode> = { Sent: <Send className="w-3.5 h-3.5" />, Accepted: <CheckCircle2 className="w-3.5 h-3.5" />, Declined: <XCircle className="w-3.5 h-3.5" /> };

type Props = {
  quote: QuoteDto;
  doc: QuoteDoc;
  layout: ModuleLayoutDto;
  settings: QuoteSettings;
  abilities: QuoteAbilities;
  list: QuoteListData;
  params: QuoteListParams;
  salesOrders: number;
  openSend: boolean;
  today: string;
};

const tool = 'inline-flex items-center gap-[6px] h-[39px] px-[13px] text-[13px] text-[#575a6f] hover:bg-[#eceef8] whitespace-nowrap';
const divider = <span className="w-px h-[18px] bg-[#e3e5ee] self-center" aria-hidden />;

// Put inside a Link: the icon turns into a spinner while the page behind the link is still opening, so a slow open never looks like a dead button
function LinkIcon({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className="w-3.5 h-3.5" /> : children;
}

export default function QuoteView({ quote, doc, layout, settings, abilities, list, params, salesOrders, openSend, today }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [tab, setTab] = useState<'details' | 'activity' | 'number'>('details');
  const [view, setView] = useState<'pdf' | 'details'>('pdf');
  const [rows, setRows] = useState(list.rows);
  const [page, setPage] = useState(list.page);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [send, setSend] = useState(openSend);
  const [share, setShare] = useState<ShareInfo | 'busy' | null | false>(false); // false: closed. The link is made when Share is clicked
  const [convert, setConvert] = useState<string | null>(null);
  const [removing, setRemoving] = useState<null | 'one' | 'many'>(null);
  const [busy, setBusy] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [numbering, setNumbering] = useState(false);
  const [activity, setActivity] = useState<ActivityDto[] | null>(null);
  const [activityError, setActivityError] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false); // while the PDF is made, an off-screen copy of the document (and nothing else) is on the page
  const exportRef = useRef<HTMLDivElement>(null);

  const [pending, startTransition] = useTransition();
  const [searchOpen, setSearchOpen] = useState(!!params.q);
  const [term, setTerm] = useState(params.q ?? '');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if ((params.q ?? '') === term.trim()) return;
    const t = setTimeout(() => {
      startTransition(() => {
        router.replace(`/quotes/${quote.id}${queryOf(params, { q: term.trim() || undefined })}`);
      });
    }, 200);
    return () => clearTimeout(t);
  }, [term, quote.id, params, router]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const [prevQ, setPrevQ] = useState(params.q);
  if (prevQ !== params.q) {
    setPrevQ(params.q);
    setTerm(params.q ?? '');
    if (params.q) setSearchOpen(true);
  }

  const toggleSearch = () => {
    if (searchOpen) {
      if (term || params.q) {
        setTerm('');
        startTransition(() => {
          router.replace(`/quotes/${quote.id}${queryOf(params, { q: undefined })}`);
        });
      }
      setSearchOpen(false);
    } else {
      setSearchOpen(true);
    }
  };

  const clearSearch = () => {
    setTerm('');
    if (params.q) {
      startTransition(() => {
        router.replace(`/quotes/${quote.id}${queryOf(params, { q: undefined })}`);
      });
    }
    searchInputRef.current?.focus();
  };

  const money = (n: number) => formatMoney(n, settings.display.currencySymbol, settings.display.grouping);
  const query = queryOf(params, {});
  const locked = quote.status === 'Invoiced';

  // A list that was loaded again (a refresh, another view) starts again
  const [seenList, setSeenList] = useState(list);
  if (seenList !== list) { setSeenList(list); setRows(list.rows); setPage(list.page); setSelected(new Set()); }
  // "?send=1" opens the Send window once and is then dropped from the address
  const stripped = useRef(false);
  useEffect(() => {
    if (openSend && !stripped.current) { stripped.current = true; router.replace(`${pathname}${query}`); }
  }, [openSend, pathname, query, router]);

  useEffect(() => {
    if (tab !== 'activity' || activity) return;
    callApi<{ items: ActivityDto[] }>(`/api/quotes/${quote.id}/activity`, 'GET').then(r => setActivity(r.items)).catch(e => setActivityError(e instanceof Error ? e.message : 'Could not load the activity'));
  }, [tab, activity, quote.id]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await callApi<QuoteListData>(`/api/quotes${queryOf(params, { page: page + 1 })}`, 'GET');
      setRows(r => [...r, ...next.rows.filter(n => !r.some(x => x.id === n.id))]);
      setPage(next.page);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load more quotes');
    } finally {
      setLoadingMore(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok); router.refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };

  // Share: the link is made (or the one that still works is found) before the window opens
  const openShare = async () => {
    if (share === 'busy') return;
    setShare('busy');
    try {
      setShare((await callApi<{ share: ShareInfo }>(`/api/quotes/${quote.id}/share`, 'POST')).share);
      router.refresh();
    } catch (e) {
      setShare(false);
      toast.error(e instanceof Error ? e.message : 'Could not create the link');
    }
  };

  const setStatus = (status: string) => run(() => callApi(`/api/quotes/${quote.id}/status`, 'POST', { status }), `Marked as ${status.toLowerCase()}`);
  // "PDF": the quote document alone (never the status band) is drawn off-screen, made into a PDF and saved as <quote number>.pdf
  const downloadPdf = async () => {
    if (pdfBusy) return;
    flushSync(() => setPdfBusy(true));
    try {
      const node = exportRef.current?.querySelector<HTMLElement>('[data-quote-document]');
      if (!node) throw new Error('The quote is not ready yet.');
      const { makeQuotePdf, saveBlob } = await import('./pdf');
      const blob = await makeQuotePdf(node, { title: quote.quoteNumber, author: doc.company.name || undefined });
      saveBlob(blob, quotePdfName(quote.quoteNumber));
      toast.success('PDF downloaded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not make the PDF');
    } finally {
      setPdfBusy(false);
    }
  };
  const doConvert = async () => {
    if (!convert) return;
    const target = convert;
    setConvert(null);
    await run(() => callApi(`/api/quotes/${quote.id}/convert`, 'POST', { target }), target === 'invoice' ? 'Converted to an invoice' : 'A sales order was created');
  };
  const clone = async () => {
    setBusy(true);
    try {
      const res = await callApi<{ id: string; quoteNumber: string }>(`/api/quotes/${quote.id}/clone`, 'POST');
      toast.success(`${res.quoteNumber} created as a draft`);
      router.push(`/quotes/${res.id}/edit`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not clone the quote');
      setBusy(false);
    }
  };
  const removeSelected = async (ids: string[]) => {
    setBusy(true);
    let done = 0;
    let failure = '';
    for (const id of ids) {
      try { await callApi(`/api/quotes/${id}`, 'DELETE'); done++; } catch (e) { failure = e instanceof Error ? e.message : 'Could not delete'; }
    }
    setBusy(false);
    setRemoving(null);
    setSelected(new Set());
    if (done) toast.success(`${done} quote${done === 1 ? '' : 's'} deleted`);
    if (failure) toast.error(failure);
    if (ids.includes(quote.id) && done) router.push(`/quotes${query}`);
    else router.refresh();
  };

  const statusViews = useMemo(() => [{ label: 'All Quotes', status: undefined as string | undefined }, ...QUOTE_STATUSES.map(s => ({ label: s as string, status: s as string }))], []);
  const title = params.status ? `${params.status} Quotes` : 'All Quotes';
  const hasMore = page < list.pageCount;
  const toggleOne = (id: string) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const printHref = `/quotes/${quote.id}/print`;
  // What the page shows, chosen in the header: the document (PDF), the details, the activity or the quote number
  const section = tab === 'details' ? view : tab;
  const showSection = (id: 'pdf' | 'details' | 'activity' | 'number') => { if (id === 'pdf' || id === 'details') { setTab('details'); setView(id); } else setTab(id); };

  return (
    <div className="flex h-[calc(100vh-64px)] lg:h-screen overflow-hidden bg-white">
      {/* The list of quotes */}
      <aside className="hidden lg:flex w-[360px] shrink-0 flex-col border-r border-[#ebeaf2] bg-white" aria-label="Quotes">
        <div className="h-[58px] px-[18px] flex items-center gap-2 shrink-0">
          {selected.size > 0 ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="text-[15px] font-semibold whitespace-nowrap">{selected.size} selected</span>
              {abilities.delete && <Button kind="ghost" onClick={() => setRemoving('many')}><Trash2 className="w-3.5 h-3.5 text-[#d9232b]" /> Delete</Button>}
              <Button kind="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          ) : (
            <Menu width={220} className="min-w-0 flex-1" trigger={({ toggle }) => (
              <button type="button" onClick={toggle} aria-haspopup="menu" className="flex items-center gap-1.5 text-[18px] font-semibold text-[#222529]">{title} <ChevronDown className="w-4 h-4 text-[#548df6]" strokeWidth={3} /></button>
            )}>
              {close => statusViews.map(v => (
                <MenuItem key={v.label} onClick={() => { close(); router.push(`/quotes/${quote.id}${queryOf(params, { status: v.status })}`); }}>
                  <span className={params.status === v.status ? 'font-semibold text-[#548df6]' : ''}>{v.label}</span>
                </MenuItem>
              ))}
            </Menu>
          )}
          {abilities.create && <Link href="/quotes/new" aria-label="New quote" title="New quote" className="w-[32px] h-[32px] rounded-[4px] bg-[#548df6] hover:bg-[#4a82ea] text-white flex items-center justify-center shrink-0"><Plus className="w-4 h-4" /></Link>}
          <button
            type="button"
            onClick={toggleSearch}
            aria-label={searchOpen ? 'Close search' : 'Search quotes'}
            title="Search quotes"
            className={`w-[32px] h-[32px] rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${
              searchOpen || params.q
                ? 'border-[#548df6] bg-[#eef4ff] text-[#548df6]'
                : 'border-[#d7d5e1] hover:bg-[#f1f1fa] text-[#575a6f]'
            }`}
          >
            <Search className="w-4 h-4" />
          </button>
          <Menu align="right" width={210} trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="More" aria-haspopup="menu" className="w-[32px] h-[32px] rounded-[4px] border border-[#d7d5e1] hover:bg-[#f1f1fa] flex items-center justify-center shrink-0"><MoreHorizontal className="w-4 h-4" /></button>
          )}>
            {close => (
              <>
                <Link href={`/quotes${query}`} onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]">View as a table</Link>
                <Link href="/items" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]">Items</Link>
                <Link href="/quotes/settings" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]">Quote Settings</Link>
              </>
            )}
          </Menu>
        </div>
        {searchOpen && (
          <div className="px-[16px] pb-[10px] flex items-center gap-2 shrink-0 bg-[#f9f9fb]">
            <div className="relative flex-1">
              {pending ? (
                <Spinner className="w-3.5 h-3.5 text-[#548df6] absolute left-2.5 top-1/2 -translate-y-1/2" />
              ) : (
                <Search className="w-3.5 h-3.5 text-[#9ca0ab] absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
              )}
              <input
                ref={searchInputRef}
                value={term}
                onChange={e => setTerm(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Escape') {
                    clearSearch();
                    setSearchOpen(false);
                  }
                }}
                placeholder="Search quotes by number, customer..."
                aria-label="Search quotes"
                className="w-full h-[32px] pl-8 pr-7 text-[12.5px] border border-[#d7d5e1] rounded-[4px] bg-white focus:outline-none focus:border-[#548df6]"
              />
              {term && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9ca0ab] hover:text-[#22263b]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                clearSearch();
                setSearchOpen(false);
              }}
              className="text-[12px] text-[#6d7189] hover:text-[#22263b] px-1 shrink-0 font-medium"
            >
              Cancel
            </button>
          </div>
        )}
        <ul className="flex-1 overflow-y-auto q-scroll border-t border-[#ebeaf2]" data-quote-list>
          {rows.map(r => (
            <li key={r.id} className={`flex gap-3 pl-[21px] pr-[16px] py-[14px] border-b border-[#ebeaf2] ${r.id === quote.id ? 'bg-[#f1f1fa]' : 'hover:bg-[#f6f6fa]'}`} aria-current={r.id === quote.id ? 'true' : undefined}>
              <input type="checkbox" className="q-check q-check-lg mt-[6px]" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.number}`} />
              <Link href={`/quotes/${r.id}${query}`} className="min-w-0 flex-1 block">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[15.5px] text-[#21263c]">{r.customer || '—'}</span>
                  <span className="shrink-0 text-[15.5px] text-[#21263c]">{money(r.total)}</span>
                </span>
                <span className="block text-[13px] text-[#4c526c] mt-[2px]">{r.number} <span aria-hidden>•</span> {formatQuoteDay(r.date)}</span>
                <StatusText status={r.status} size={13.75} className="block mt-[6px]" />
              </Link>
            </li>
          ))}
          {rows.length === 0 && (
            <li className="px-4 py-8 text-center text-[13px] text-[#6d7189]">
              <FileText className="w-7 h-7 mx-auto text-[#c9cbd6] mb-2" aria-hidden />
              <p>No quotes match{term.trim() ? ` "${term.trim()}"` : ''}.</p>
              {(term || params.q) && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="mt-2 text-[12.5px] text-[#548df6] hover:underline"
                >
                  Clear search
                </button>
              )}
            </li>
          )}
          {hasMore && <li className="p-3 text-center"><Button kind="ghost" onClick={loadMore} busy={loadingMore}>Load more</Button></li>}
        </ul>
      </aside>

      {/* The quote */}
      <section className="flex-1 min-w-0 flex flex-col bg-[#fafafc]">
        <div className="bg-white shrink-0">
          <div className="min-h-[59px] py-[8px] px-[18px] flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link href={`/quotes${query}`} className="lg:hidden text-[13px] text-[#548df6]">All Quotes</Link>
            <h1 className="text-[18px] font-medium text-[#232535] truncate" data-quote-title>{quote.quoteNumber}</h1>
            <div role="tablist" aria-label="View" className="ml-auto inline-flex rounded-[4px] bg-[#e9ebf3] p-[2px] text-[12px]" data-view-switch>
              {([['pdf', 'PDF'], ['details', 'Details'], ['activity', 'Activity'], ['number', 'Number']] as const).map(([id, text]) => (
                <button key={id} type="button" role="tab" aria-selected={section === id} onClick={() => showSection(id)} className={`h-[26px] px-[12px] rounded-[3px] ${section === id ? 'bg-white shadow-sm font-medium text-[#22263b]' : 'text-[#575a6f] hover:text-[#22263b]'}`}>{text}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Menu align="right" width={300} trigger={({ toggle }) => (
                <button type="button" onClick={toggle} aria-label="Attachments" aria-haspopup="menu" title="Attachments" className="relative w-[34px] h-[34px] rounded-[4px] border border-[#d7d5e1] hover:bg-[#f1f1fa] flex items-center justify-center text-[#575a6f]">
                  <Paperclip className="w-4 h-4" />{quote.files.length > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#548df6] text-white text-[10px] flex items-center justify-center">{quote.files.length}</span>}
                </button>
              )}>
                {close => quote.files.length === 0 ? <p className="px-3 py-2 text-[12px] text-[#6d7189]">No files are attached to this quote.</p> : (
                  <>
                    {quote.files.map(f => (
                      <a key={f.id} href={f.url ?? '#'} target="_blank" rel="noopener noreferrer" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#f1f1fa]">
                        <FileText className="w-3.5 h-3.5 text-[#9ca0ab] shrink-0" /><span className="truncate flex-1 text-[12.5px]">{f.fileName}</span><span className="text-[11px] text-[#9ca0ab]">{formatBytes(f.size)}</span>
                      </a>
                    ))}
                  </>
                )}
              </Menu>
              <button type="button" onClick={() => setTab('activity')} aria-label="Activity" title="Activity" className="w-[34px] h-[34px] rounded-[4px] border border-[#d7d5e1] hover:bg-[#f1f1fa] flex items-center justify-center text-[#575a6f]"><MessageSquare className="w-4 h-4" /></button>
              <Link href={`/quotes${query}`} aria-label="Close" title="Close" className="w-[34px] h-[34px] flex items-center justify-center text-[#e5484d] hover:bg-[#fdeeee] rounded-[4px]"><X className="w-5 h-5" /></Link>
            </div>
          </div>

          {/* No overflow here (not even overflow-x): a bar that scrolls also cuts off the menus that open under its buttons. A narrow screen wraps the buttons instead. */}
          <div className="min-h-[41px] bg-[#f7f8fc] border-y border-[#e9eaf4] flex flex-wrap items-stretch" role="toolbar" aria-label="Quote actions">
            {abilities.edit && !locked && <Link href={`/quotes/${quote.id}/edit`} className={tool}><LinkIcon><Pencil className="w-3.5 h-3.5" /></LinkIcon> Edit</Link>}
            {abilities.edit && !locked && divider}
            {abilities.edit && <button type="button" onClick={() => setSend(true)} className={tool}><Mail className="w-3.5 h-3.5" /> Send</button>}
            {abilities.edit && divider}
            {abilities.edit && <button type="button" onClick={openShare} className={tool}><Share2 className="w-3.5 h-3.5" /> Share</button>}
            {abilities.edit && divider}
            <Menu width={170} className="h-[39px]" trigger={({ toggle }) => <button type="button" onClick={toggle} aria-haspopup="menu" disabled={pdfBusy} className={tool}>{pdfBusy ? <Spinner className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />} PDF/Print <ChevronDown className="w-3 h-3" /></button>}>
              {close => (
                <>
                  <MenuItem icon={<FileText className="w-3.5 h-3.5" />} onClick={() => { close(); void downloadPdf(); }}>PDF</MenuItem>
                  <a href={`${printHref}?print=1`} target="_blank" rel="noopener noreferrer" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]"><span className="w-4 flex items-center justify-center text-[#6d7189]"><Printer className="w-3.5 h-3.5" /></span> Print</a>
                </>
              )}
            </Menu>
            {abilities.edit && divider}
            {abilities.edit && (
              <Menu width={240} className="h-[39px]" trigger={({ toggle }) => <button type="button" onClick={toggle} aria-haspopup="menu" className={tool}><Repeat2 className="w-3.5 h-3.5" /> Convert <ChevronDown className="w-3 h-3" /></button>}>
                {close => CONVERT.map(c => (
                  <MenuItem key={c.id} disabled={locked || (c.id === 'salesOrder' && salesOrders > 0)} onClick={() => { close(); setConvert(c.id); }}>{c.label}{c.id === 'salesOrder' && salesOrders > 0 ? ' (done)' : ''}</MenuItem>
                ))}
              </Menu>
            )}
            {divider}
            <Menu width={230} className="h-[39px]" trigger={({ toggle }) => <button type="button" onClick={toggle} aria-label="More" aria-haspopup="menu" className={tool}><MoreHorizontal className="w-4 h-4" /></button>}>
              {close => (
                <>
                  {abilities.edit && (STATUS_ACTIONS[quote.status as QuoteStatus] ?? []).map(s => <MenuItem key={s} icon={STATUS_ICON[s]} onClick={() => { close(); void setStatus(s); }}>Mark as {s}</MenuItem>)}
                  {abilities.create && <MenuItem icon={<Copy className="w-3.5 h-3.5" />} onClick={() => { close(); void clone(); }}>Clone</MenuItem>}
                  <MenuRule />
                  <Link href="/quotes/settings" onClick={close} role="menuitem" className="flex items-center gap-2 px-3 h-[32px] hover:bg-[#f1f1fa]"><span className="w-4 flex justify-center text-[#6d7189]"><Settings className="w-3.5 h-3.5" /></span> Quote Settings</Link>
                  {abilities.layout && <MenuItem icon={<LayoutTemplate className="w-3.5 h-3.5" />} onClick={() => { close(); setLayoutOpen(true); }}>Edit Page Layout</MenuItem>}
                  {abilities.delete && !locked && <><MenuRule /><MenuItem danger icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => { close(); setRemoving('one'); }}>Delete</MenuItem></>}
                </>
              )}
            </Menu>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto q-scroll">
          {tab === 'details' && view === 'pdf' ? (
            <div className="px-[12px] pt-[8px] pb-[16px]" data-pdf-view>
              <FitWidth width={796}>
                <div className="relative border border-[#e0e1ea] bg-white w-[794px]"><QuoteDocument doc={doc} /><StatusBand status={doc.status} /></div>
              </FitWidth>
              <p className="mt-4 text-[13px] text-[#575a6f]">To view additional quote information not displayed in the PDF, switch to the <button type="button" onClick={() => setView('details')} className="text-[#548df6] hover:underline">Quote Details View</button>.</p>
            </div>
          ) : (
          <div className="px-[18px] lg:px-[36px] pt-[20px] pb-[24px]">
          <div className="bg-white border border-[#ededf0] rounded-[8px] px-[24px] pt-[8px] pb-[24px] min-h-full">
            {tab === 'details' && view === 'details' && <div className="mt-6"><QuoteDetails quote={quote} layout={layout} settings={settings} /></div>}

            {tab === 'activity' && (
              <div className="mt-6" data-activity>
                {!activity && !activityError && <p className="flex items-center gap-2 text-[13px] text-[#6d7189]"><Spinner className="w-4 h-4" /> Loading…</p>}
                {activityError && <p className="text-[13px] text-[#d9232b]">{activityError}</p>}
                {activity && activity.length === 0 && <p className="text-[13px] text-[#6d7189]">Nothing has happened to this quote yet.</p>}
                <ol className="relative border-l border-[#ebeaf2] ml-2 space-y-5">
                  {activity?.map(a => (
                    <li key={a.id} className="pl-5 relative">
                      <span className="absolute -left-[5px] top-[6px] w-[9px] h-[9px] rounded-full bg-[#548df6]" aria-hidden />
                      <p className="text-[13px] text-[#22263b]">{a.text}</p>
                      <p className="text-[12px] text-[#6d7189]">{new Date(a.at).toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}{a.by ? ` · ${a.by}` : ''}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {tab === 'number' && (
              <div className="mt-6 max-w-[560px] text-[13px] space-y-3" data-number-tab>
                <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-y-2">
                  <span className="text-[#6d7189]">Quote Number</span><span className="font-medium">{quote.quoteNumber}</span>
                  <span className="text-[#6d7189]">Number series</span><span>{quote.numberSeries ?? 'Typed by hand'}</span>
                  <span className="text-[#6d7189]">Running number</span><span>{quote.numberSeq ?? '—'}</span>
                  <span className="text-[#6d7189]">Format</span><span className="font-mono text-[12px]">{settings.numbering.pattern}</span>
                  <span className="text-[#6d7189]">New series</span><span>{settings.numbering.resetEachFy ? 'every financial year' : 'never'}</span>
                </div>
                <p className="text-[#6d7189]">A quote number is never used twice, even if the quote is deleted.</p>
                <Button kind="ghost" onClick={() => setNumbering(true)}><Settings className="w-3.5 h-3.5" /> Quote number preferences</Button>
              </div>
            )}
          </div>
          </div>
          )}
        </div>
      </section>

      {pdfBusy && createPortal(<div ref={exportRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0, width: 794, pointerEvents: 'none' }}><QuoteDocument doc={doc} forPdf /></div>, document.body)}
      {send && <SendModal quote={quote} settings={settings} onClose={() => setSend(false)} onSent={() => { setSend(false); router.refresh(); }} />}
      {share !== false && share !== 'busy' && <ShareModal quote={quote} initial={share} onClose={() => setShare(false)} onChanged={() => router.refresh()} />}
      {layoutOpen && <LayoutEditor moduleId="quote" initial={layout} onClose={changed => { setLayoutOpen(false); if (changed) router.refresh(); }} />}
      {numbering && <NumberingModal settings={settings} canEdit={abilities.settings} day={today} onClose={() => setNumbering(false)} onSaved={() => { setNumbering(false); router.refresh(); }} />}
      {convert && (
        <Modal title={CONVERT.find(c => c.id === convert)?.label ?? 'Convert'} onClose={() => setConvert(null)} width={460} footer={(
          <>
            <Button onClick={() => setConvert(null)}>Cancel</Button>
            <Button kind="blue" onClick={doConvert} busy={busy}>Convert</Button>
          </>
        )}>
          <p className="text-[13px]">{convert === 'invoice' ? `${quote.quoteNumber} will be marked as Invoiced. It cannot be edited or deleted after that.` : `A sales order for ${money(quote.totals.total)} will be created from ${quote.quoteNumber}${quote.status === 'Sent' ? ', and the quote will be marked as Accepted' : ''}.`}</p>
        </Modal>
      )}
      {removing && (
        <Modal title={removing === 'one' ? 'Delete this quote?' : 'Delete quotes?'} onClose={() => !busy && setRemoving(null)} busy={busy} width={440} footer={(
          <>
            <Button onClick={() => setRemoving(null)} disabled={busy}>Cancel</Button>
            <Button kind="danger" onClick={() => removeSelected(removing === 'one' ? [quote.id] : Array.from(selected))} busy={busy}>Delete</Button>
          </>
        )}>
          <p className="text-[13px]">{removing === 'one' ? `${quote.quoteNumber} will be removed from the list. Its number will not be used again.` : `${selected.size} quote${selected.size === 1 ? '' : 's'} will be removed from the list. Their numbers will not be used again. An invoiced quote cannot be deleted.`}</p>
        </Modal>
      )}
    </div>
  );
}
