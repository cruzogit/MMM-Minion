'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, ChevronDown, GripVertical, ImageIcon, MoreHorizontal, Pencil, Plus, Search, X } from 'lucide-react';
import { callApi } from '@/lib/leads/client';
import type { LayoutField } from '@/lib/records/types';
import { formatAmount, formatMoney } from '@/lib/quotes/format';
import { digitsOnly, taxCodePrint } from '@/lib/quotes/item-constants';
import type { CodeSuggestions, ItemDto, QuoteSettings } from '@/lib/quotes/types';
import { searchLookup } from '../records/client';
import QField, { type QCtx } from './QField';
import { Button, Combo, Menu, MenuItem, MenuRule, Modal, Spinner, inputClass, useDismiss } from './ui';
import ItemOverlay from './ItemOverlay';
import { itemImageSrc } from './item-client';
import { defaultTaxId } from '@/lib/quotes/taxes';
import { blankLine, isBlankLine, lineFromItem, newKey, syncLineWithItem, type LineState } from './form-state';

const PICK_PAGE = 100; // items the picker of a row loads at a time
const BULK_PAGE = 200; // items Add Items in Bulk loads at a time

const cell = 'w-full h-[34px] px-[8px] text-[13px] bg-transparent border border-transparent rounded-[4px] hover:border-[#d7d5e1] focus:border-[#548df6] focus:bg-white focus:outline-none';

// ---------------------------------------------------------------------------
// "Type or click to select an item": a box that lists the items of the Item Master under it
// ---------------------------------------------------------------------------
function ItemPicker({ id, value, linked, invalid, onType, onPick, canAdd, onAddNew, display }: {
  id: string; value: string; linked: boolean; invalid?: boolean; onType: (text: string) => void; onPick: (item: ItemDto) => void; canAdd: boolean; onAddNew: (name: string) => void; display: QuoteSettings['display'];
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [items, setItems] = useState<ItemDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const [more, setMore] = useState(false); // there are more matches than the list holds: it goes on when it is scrolled to its end
  const [loadingMore, setLoadingMore] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, wrap);

  // The list is placed on the screen (not inside the table) so the table never clips it
  const place = useCallback(() => {
    const r = input.current?.getBoundingClientRect();
    if (r) setBox({ left: r.left, top: r.bottom + 2, width: Math.max(r.width + 140, 480) });
  }, []);
  useEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await callApi<{ items: ItemDto[] }>(`/api/quotes/items?picker=1&limit=${PICK_PAGE}&q=${encodeURIComponent(typed)}`, 'GET');
        if (live) { setItems(res.items); setMore(res.items.length >= PICK_PAGE); setActive(0); setError(''); }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the items');
      } finally {
        if (live) setBusy(false);
      }
    }, typed ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [typed, open]);

  const loadMore = async () => {
    if (!more || loadingMore || busy) return;
    setLoadingMore(true);
    try {
      const res = await callApi<{ items: ItemDto[] }>(`/api/quotes/items?picker=1&limit=${PICK_PAGE}&offset=${items.length}&q=${encodeURIComponent(typed)}`, 'GET');
      setItems(cur => [...cur, ...res.items.filter(n => !cur.some(c => c.id === n.id))]);
      setMore(res.items.length >= PICK_PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more items');
    } finally {
      setLoadingMore(false);
    }
  };
  const pick = (item: ItemDto) => { onPick(item); setOpen(false); setTyped(''); };
  const tall = !value.trim() || open; // an empty or open box is two lines tall (as in the reference); the box of a chosen item is one line

  return (
    <div ref={wrap} className="relative">
      <input
        ref={input}
        id={id}
        value={value}
        placeholder="Type or click to select an item."
        autoComplete="off"
        aria-label="Item details"
        aria-invalid={invalid || undefined}
        onFocus={() => { setTyped(''); setOpen(true); }}
        onBlur={e => { if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}
        onClick={() => { if (!open) { setTyped(''); setOpen(true); } }}
        onChange={e => { onType(e.target.value); setTyped(e.target.value); if (!open) setOpen(true); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(items.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
          else if (e.key === 'Enter' && open && items[active] && typed) { e.preventDefault(); pick(items[active]); }
          else if (e.key === 'Escape') setOpen(false);
        }}
        className={`w-full px-[8px] text-[14px] text-[#22263b] bg-white border rounded-[4px] placeholder:text-[#9ca0ab] focus:outline-none ${tall ? 'h-[51px] pt-[7px] pb-[26px] leading-[18px]' : 'h-[34px]'} ${linked ? 'font-medium' : ''} ${invalid ? 'border-[#e5484d]' : open ? 'border-[#548df6]' : 'border-transparent hover:border-[#d7d5e1]'}`}
      />
      {open && box && (
        <div style={{ position: 'fixed', left: box.left, top: box.top, width: box.width }} className="z-[60] bg-white border border-[#d7d5e1] rounded-[6px] shadow-[0_8px_24px_rgba(34,38,59,0.18)] overflow-hidden" data-item-list>
          <ul role="listbox" aria-label="Items" className="max-h-[300px] overflow-y-auto q-scroll p-[4px]" onScroll={e => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) void loadMore(); }}>
            {busy && items.length === 0 && <li className="px-3 py-3 text-[13px] text-[#6d7189] flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> Loading items…</li>}
            {error && <li className="px-3 py-2 text-[13px] text-[#d9232b]">{error}</li>}
            {!busy && !error && items.length === 0 && <li className="px-3 py-3 text-[13px] text-[#6d7189]">{typed ? 'No item matches. Keep typing to use it as a one-off item, or add it as a new item.' : 'The Item Master has no items yet.'}</li>}
            {items.map((item, i) => (
              <li key={item.id} role="option" aria-selected={i === active} className={i > 0 && i !== active && i - 1 !== active ? 'border-t border-[#e5e6ee] mx-[10px]' : ''}>
                <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => pick(item)} onMouseEnter={() => setActive(i)} className={`w-full text-left px-[10px] py-[8px] rounded-[4px] ${i === active ? 'bg-[#4a8cf7] text-white' : ''}`}>
                  <span className={`block text-[14px] leading-[20px] truncate ${i === active ? '' : 'text-[#22263b]'}`}>{item.name}</span>
                  <span className={`block text-[12px] leading-[18px] ${i === active ? 'text-white/90' : 'text-[#6d7189]'}`}>Rate: {formatMoney(item.rate, display.currencySymbol, display.grouping)}{item.unit ? ` / ${item.unit}` : ''}{item.hsn ? ` · ${item.kind === 'Service' ? 'SAC' : 'HSN'} ${item.hsn}` : ''}</span>
                </button>
              </li>
            ))}
            {loadingMore && <li className="px-3 py-2 text-[13px] text-[#6d7189] flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> Loading more…</li>}
          </ul>
          {canAdd && (
            <div className="border-t border-[#ebeaf2]">
              <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setOpen(false); onAddNew(typed.trim()); }} className="w-full flex items-center gap-[10px] px-[14px] h-[42px] text-[13px] text-[#548df6] hover:bg-[#f1f1fa]"><Plus className="w-4 h-4 rounded-full bg-[#548df6] text-white p-[2px]" aria-hidden /> Add New Item</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Under the description: GOODS  HSN Code: 998391 ✎   /   SERVICE  SAC Code: 998391 ✎
// ---------------------------------------------------------------------------
function TaxCodeLine({ name, kind, code, onChange, allowToggle, onKindToggle, onChangeKind }: { name: string; kind: LineState['kind']; code: string; onChange: (code: string) => void; allowToggle: boolean; onKindToggle: () => void; onChangeKind?: (kind: 'Goods'|'Service') => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(code);
  const box = useRef<HTMLDivElement>(null);
  const autoFilled = useRef(code);

  useEffect(() => {
    if (code !== '' && code !== autoFilled.current) return;
    if (name.trim().length < 3) return;
    let live = true;
    const t = setTimeout(() => {
      callApi<CodeSuggestions>(`/api/quotes/items/suggest-code?kind=${kind || 'Service'}&name=${encodeURIComponent(name)}`, 'GET')
        .then(res => {
          if (!live) return;
          if (res.best) {
            autoFilled.current = res.best.code;
            onChange(res.best.code);
          } else if (res.switchTo && res.switchTo.best && onChangeKind) {
            autoFilled.current = res.switchTo.best.code;
            onChangeKind(res.switchTo.kind);
            onChange(res.switchTo.best.code);
          }
        }).catch(() => {});
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [name, kind, code, onChange, onChangeKind]);

  useDismiss(editing, () => setEditing(false), box);
  
  if (!kind && !code && !allowToggle) return null;
  const effectiveKind = kind || 'Service';

  const commit = () => { setEditing(false); const next = digitsOnly(draft); if (next !== code) onChange(next); };

  return (
    <div className="mt-[10px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-[13px] leading-[20px] min-h-[22px] relative" data-tax-code ref={box}>
      {effectiveKind && <span onDoubleClick={allowToggle ? onKindToggle : undefined} className={`inline-flex items-center h-[18px] px-[6px] rounded-[3px] text-white text-[10px] font-bold tracking-[0.3px] uppercase ${allowToggle ? 'cursor-pointer select-none' : ''} ${effectiveKind === 'Service' ? 'bg-[#29903b]' : 'bg-[#1e9bf0]'}`}>{effectiveKind}</span>}
      <span onDoubleClick={allowToggle ? onKindToggle : undefined} className={`text-[#6d7189] ${allowToggle ? 'cursor-pointer select-none' : ''}`}>{taxCodePrint(effectiveKind || null)}:</span>
      
      {editing ? (
         <div className="absolute top-[100%] left-0 mt-[8px] z-50 bg-white border border-[#e3e5ee] rounded-[6px] shadow-[0_4px_24px_rgba(34,38,59,0.12)] p-[12px] min-w-[300px]">
           <div className="text-[13px] font-medium text-[#22263b] mb-[8px]">{effectiveKind === 'Service' ? 'SAC' : 'HSN Code'}</div>
           <div className="flex items-center gap-2 mb-[12px]">
             <div className="flex-1 min-w-0">
               <Combo 
                 htmlId={`taxcode-${effectiveKind}`}
                 value={draft}
                 shown={draft}
                 onChange={(id) => setDraft(id ?? '')}
                 search={async (q) => {
                    const res = await callApi<CodeSuggestions>(`/api/quotes/items/suggest-code?kind=${effectiveKind}&name=${encodeURIComponent(q || name)}`, 'GET');
                    const arr = [];
                    if (res.best) arr.push({ id: res.best.code, label: res.best.code, sub: res.best.description });
                    for (const o of res.others) arr.push({ id: o.code, label: o.code, sub: o.description });
                    return arr;
                 }}
                 creatable
                 clearable
                 placeholder="Type to add or search"
                 ariaLabel={taxCodePrint(effectiveKind)}
               />
             </div>
             <Search className="w-4 h-4 text-[#355bd4] shrink-0" />
           </div>
           <div className="flex items-center gap-2">
             <button type="button" onClick={commit} className="h-[28px] px-[12px] bg-[#548df6] text-white text-[13px] font-medium rounded-[4px] hover:bg-[#355bd4]">Save</button>
             <button type="button" onClick={() => { setDraft(code); setEditing(false); }} className="h-[28px] px-[12px] bg-[#f2f3f4] text-[#22263b] text-[13px] font-medium rounded-[4px] border border-[#e3e5ee] hover:bg-[#e3e5ee]">Close</button>
           </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => { setDraft(code); setEditing(true); }} className="text-[#355bd4] hover:underline flex items-center gap-1">
             {code || 'Update'}
             {!code && <Pencil className="w-[13px] h-[13px] ml-[2px]" />}
          </button>
          {code && <button type="button" onClick={() => { setDraft(code); setEditing(true); }} aria-label={`Edit the ${taxCodePrint(effectiveKind || null)}`} className="text-[#7f8497] hover:text-[#548df6]"><Pencil className="w-[13px] h-[13px]" /></button>}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Items in Bulk: tick items of the Item Master, add them all at once
// ---------------------------------------------------------------------------
function BulkModal({ display, onClose, onAdd }: { display: QuoteSettings['display']; onClose: () => void; onAdd: (items: ItemDto[]) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ItemDto[]>([]);
  const [picked, setPicked] = useState<Map<string, ItemDto>>(new Map());
  const [busy, setBusy] = useState(true);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await callApi<{ items: ItemDto[] }>(`/api/quotes/items?picker=1&limit=${BULK_PAGE}&q=${encodeURIComponent(q)}`, 'GET');
        if (live) { setItems(res.items); setMore(res.items.length >= BULK_PAGE); setError(''); }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : 'Could not load the items');
      } finally {
        if (live) setBusy(false);
      }
    }, q ? 250 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const res = await callApi<{ items: ItemDto[] }>(`/api/quotes/items?picker=1&limit=${BULK_PAGE}&offset=${items.length}&q=${encodeURIComponent(q)}`, 'GET');
      setItems(cur => [...cur, ...res.items.filter(n => !cur.some(c => c.id === n.id))]);
      setMore(res.items.length >= BULK_PAGE);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more items');
    } finally {
      setLoadingMore(false);
    }
  };
  const toggle = (item: ItemDto) => setPicked(m => { const n = new Map(m); if (n.has(item.id)) n.delete(item.id); else n.set(item.id, item); return n; });
  return (
    <Modal title="Add Items in Bulk" onClose={onClose} width={680} footer={(
      <>
        <span className="mr-auto text-[13px] text-[#6d7189]" data-bulk-count>{picked.size} selected</span>
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="blue" disabled={picked.size === 0} onClick={() => onAdd(Array.from(picked.values()))}>Add Selected Items</Button>
      </>
    )}>
      <div className="relative mb-3">
        <Search className="w-3.5 h-3.5 text-[#9ca0ab] absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
        <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search items" aria-label="Search items" className={inputClass(false, 'pl-8')} />
        {busy && <Spinner className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9ca0ab]" />}
      </div>
      {error && <p className="text-[13px] text-[#d9232b]">{error}</p>}
      <ul className="border border-[#ebeaf2] rounded-[4px] divide-y divide-[#ebeaf2] max-h-[340px] overflow-y-auto q-scroll">
        {items.map(item => (
          <li key={item.id}>
            <label className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-[#f1f1fa]">
              <input type="checkbox" className="q-check" checked={picked.has(item.id)} onChange={() => toggle(item)} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] truncate">{item.name}</span>
                <span className="block text-[12px] text-[#6d7189] truncate">{[item.kind === 'Service' ? `SAC ${item.hsn}` : item.hsn ? `HSN ${item.hsn}` : '', item.taskTemplateName, item.description].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-[13px] text-[#6d7189] whitespace-nowrap">{formatMoney(item.rate, display.currencySymbol, display.grouping)}</span>
            </label>
          </li>
        ))}
        {!busy && items.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-[#6d7189]">No items found</li>}
        {more && <li className="p-2 text-center"><Button kind="ghost" onClick={() => void loadMore()} busy={loadingMore}>Load more items</Button></li>}
      </ul>
    </Modal>
  );
}

// The picture box at the left of a row
function Thumb({ fileId }: { fileId: string | null }) {
  return fileId ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={itemImageSrc(fileId)} alt="" className="w-[30px] h-[30px] shrink-0 rounded-[4px] object-cover border border-[#ebeaf2] bg-[#f9f9fb]" data-line-image />
  ) : (
    <div className="w-[30px] h-[28px] shrink-0 rounded-[4px] bg-[#e7e8ee] flex items-center justify-center text-white" aria-hidden><ImageIcon className="w-[20px] h-[20px]" strokeWidth={1.6} /></div>
  );
}

function SwapModal({
  currentIndex,
  onClose,
  onSwap,
  max
}: {
  currentIndex: number;
  onClose: () => void;
  onSwap: (targetIndex: number) => void;
  max: number;
}) {
  const [target, setTarget] = useState('');
  return (
    <Modal title="Swap With" onClose={onClose} width={400} footer={(
      <>
        <Button onClick={onClose}>Cancel</Button>
        <Button kind="blue" disabled={!target || isNaN(parseInt(target, 10)) || parseInt(target, 10) < 1 || parseInt(target, 10) > max || parseInt(target, 10) - 1 === currentIndex} onClick={() => onSwap(parseInt(target, 10) - 1)}>Swap</Button>
      </>
    )}>
      <div className="flex items-center gap-4 py-4">
        <div className="text-[15px] font-medium text-center w-12">{currentIndex + 1}</div>
        <div className="flex-1">
          <label className="block text-[12px] font-semibold text-gray-500 mb-1">Enter the serial number</label>
          <input
            autoFocus
            type="number"
            min={1}
            max={max}
            value={target}
            onChange={e => setTarget(e.target.value)}
            className={inputClass(false)}
            placeholder="e.g. 2"
          />
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// The Item Table of the quote form
// ---------------------------------------------------------------------------
export default function LineItems({ title, lines, setLines, columns, settings, amounts, errors, ctx, canAddItem, canEditItem = false, interState = false, aside, below }: {
  title: string;
  aside?: React.ReactNode; // beside the Add buttons (the calculation panel)
  below?: React.ReactNode; // at the bottom of the column of the Add buttons (the customer notes)
  lines: LineState[];
  setLines: (update: (cur: LineState[]) => LineState[]) => void;
  columns: LayoutField[]; // the enabled columns of the item table in the order of the layout
  settings: QuoteSettings;
  amounts: number[];
  errors: Record<string, string>;
  ctx: QCtx;
  canAddItem: boolean; // may add an item to the Item Master (New Item)
  canEditItem?: boolean; // may change an item of the Item Master (Edit item)
  interState?: boolean; // the quote is for another state: a picked item gives its Inter State Tax Rate
}) {
  const [bulk, setBulk] = useState(false);
  const [itemWindow, setItemWindow] = useState<{ key: string; itemId: string | null; name: string } | null>(null);
  const [swapWindow, setSwapWindow] = useState<{ index: number } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const display = settings.display;
  const defaultTax = defaultTaxId(settings.taxes); // what a new row starts with

  const col = (key: string) => columns.find(c => c.key === key);
  const custom = columns.filter(c => !c.isSystem);
  const tpl = col('taskTemplateId'); const hsn = col('hsn'); const unit = col('unit'); const qty = col('quantity'); const rate = col('rate'); const tax = col('taxId'); const amount = col('lineAmount');
  const colCount = 2 + (tpl ? 1 : 0) + (hsn ? 1 : 0) + (unit ? 1 : 0) + (qty ? 1 : 0) + (rate ? 1 : 0) + (tax ? 1 : 0) + custom.length + (amount ? 1 : 0);

  const patch = (key: string, p: Partial<LineState>) => setLines(cur => cur.map(l => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) => setLines(cur => { const next = cur.filter(l => l.key !== key); return next.length ? next : [blankLine(defaultTax)]; });
  const insert = (index: number, line: LineState = blankLine(defaultTax)) => setLines(cur => [...cur.slice(0, index), line, ...cur.slice(index)]);
  const swap = (indexA: number, indexB: number) => setLines(cur => {
    if (indexA < 0 || indexB < 0 || indexA >= cur.length || indexB >= cur.length || indexA === indexB) return cur;
    const next = cur.slice();
    const temp = next[indexA];
    next[indexA] = next[indexB];
    next[indexB] = temp;
    return next;
  });
  const move = (from: string, to: string) => setLines(cur => {
    const a = cur.findIndex(l => l.key === from); const b = cur.findIndex(l => l.key === to);
    if (a < 0 || b < 0 || a === b) return cur;
    const next = cur.slice(); const [item] = next.splice(a, 1); next.splice(b, 0, item);
    return next;
  });
  const clone = (l: LineState, index: number) => insert(index + 1, { ...l, key: newKey(), id: undefined });
  const addMany = (items: ItemDto[]) => setLines(cur => {
    const keep = cur.length && isBlankLine(cur[cur.length - 1]) ? cur.slice(0, -1) : cur;
    return [...keep, ...items.map(i => lineFromItem(i, undefined, defaultTax, interState))];
  });
  const taxOptions = (current: string) => settings.taxes.filter(t => t.active || t.id === current);
  const headerCls = 'text-left px-[6px] lg:px-[10px] h-[44px] text-[10px] lg:text-[11px] font-semibold uppercase tracking-[0.2px] lg:tracking-[0.4px] text-[#6d7189]';
  const descRows = (text: string) => Math.min(14, Math.max(3, text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 74)), 0)));

  const filledLines = lines.filter(l => !isBlankLine(l));
  const commonTaxId = filledLines.length > 0 && filledLines.every(l => l.taxId === filledLines[0].taxId) ? filledLines[0].taxId : '';

  return (
    <div className="w-full min-w-0">
      <div className="mr-[10px] ml-[28px] lg:mr-[125px] lg:ml-[20px] overflow-auto max-h-[60vh] lg:max-h-[65vh]">
        <div className="inline-block min-w-full align-middle">
          <div className="border border-[#ebeaf2] rounded-[6px]">
          <div className="sticky top-0 z-20 h-[47px] px-[15px] flex items-center justify-between bg-[#f9f9fb] border-b border-[#ebeaf2] rounded-t-[6px]">
            <h2 className="text-[14px] font-semibold text-black">{title}</h2>
            <Menu align="right" width={190} trigger={({ toggle }) => (
              <button type="button" onClick={toggle} aria-haspopup="menu" className="inline-flex items-center gap-1.5 text-[13px] text-[#548df6] hover:underline"><CheckCircle2 className="w-4 h-4" /> Bulk Actions</button>
            )}>
              {close => (
                <>
                  <MenuItem onClick={() => { close(); setBulk(true); }}>Add Items in Bulk</MenuItem>
                  <MenuItem onClick={() => { close(); setLines(cur => cur.filter(l => !isBlankLine(l)).length ? cur.filter(l => !isBlankLine(l)) : [blankLine(defaultTax)]); }}>Remove empty rows</MenuItem>
                  <MenuRule />
                  <MenuItem danger onClick={() => { close(); setLines(() => [blankLine(defaultTax)]); }}>Clear all rows</MenuItem>
                </>
              )}
            </Menu>
          </div>
          <table className="w-full border-collapse" style={{ tableLayout: 'auto' }} data-item-table>
            <thead className="sticky top-[47px] z-10 bg-white shadow-[0_1px_0_#ebeaf2]">
              <tr>
                <th className={`${headerCls} w-[4%] min-w-[40px] text-center`}>S.No</th>
                <th className={`${headerCls} w-[36%] min-w-[280px]`}>{col('name')?.label ?? 'Item Details'}</th>
                {tpl && <th className={`${headerCls} w-[19%] min-w-[92px] border-l border-[#ebeaf2]`}>{tpl.label}</th>}
                {hsn && <th className={`${headerCls} w-[9%] min-w-[64px]`}>{hsn.label}</th>}
                {unit && <th className={`${headerCls} w-[6%] min-w-[50px]`}>{unit.label}</th>}
                {custom.map(c => <th key={c.key} className={`${headerCls} w-[10%] min-w-[84px]`}>{c.label}</th>)}
                {qty && <th className={`${headerCls} w-[9%] min-w-[62px] text-right border-l border-[#ebeaf2]`}>{qty.label}</th>}
                {rate && <th className={`${headerCls} w-[10%] min-w-[68px] text-right border-l border-[#ebeaf2]`}>{rate.label}</th>}
                {tax && (
                  <th className={`${headerCls} w-[13%] min-w-[104px] border-l border-[#ebeaf2] relative !p-0`}>
                    <div className="absolute inset-0 flex items-center">
                      <select
                        aria-label="Bulk change tax"
                        className="w-full h-full bg-transparent border-none appearance-none outline-none focus:outline-none focus:ring-0 uppercase font-semibold tracking-[0.2px] lg:tracking-[0.4px] text-[#6d7189] pl-[6px] pr-[24px] lg:pl-[10px] lg:pr-[28px] cursor-pointer text-[10px] lg:text-[11px]"
                        value={commonTaxId}
                        onChange={e => {
                          const newTaxId = e.target.value;
                          if (newTaxId) {
                            setLines(cur => cur.map(l => isBlankLine(l) ? l : { ...l, taxId: newTaxId }));
                          }
                        }}
                      >
                        <option value="" disabled hidden>{tax.label}</option>
                        {settings.taxes.filter(t => t.active).map(t => (
                          <option key={t.id} value={t.id}>{t.name} [{t.rate}%]</option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-[#9ca0ab] absolute right-2 pointer-events-none" aria-hidden />
                    </div>
                  </th>
                )}
                {amount && <th className={`${headerCls} w-[10%] min-w-[70px] text-right border-l border-[#ebeaf2]`}>{amount.label}</th>}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const err = (k: string) => errors[`lines.${i}.${k}`];
                const rowErr = errors[`lines.${i}`];
                const filled = !isBlankLine(l);
                return (
                  <tr
                    key={l.key}
                    data-line-row
                    draggable={armed === l.key}
                    onDragStart={e => { setDragKey(l.key); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', l.key); } catch { /* some browsers refuse */ } }}
                    onDragOver={e => { if (dragKey) { e.preventDefault(); setOverKey(l.key); } }}
                    onDrop={e => { e.preventDefault(); if (dragKey) move(dragKey, l.key); setDragKey(null); setOverKey(null); setArmed(null); }}
                    onDragEnd={() => { setDragKey(null); setOverKey(null); setArmed(null); }}
                    className={`group align-top border-b border-[#ebeaf2] last:border-b-0 ${overKey === l.key && dragKey !== l.key ? 'bg-[#f1f1fa]' : ''} ${dragKey === l.key ? 'opacity-50' : ''}`}
                  >
                    <td className="relative px-[10px] py-[14px] text-center text-[12.5px] font-medium text-[#7f8497] select-none">
                      <button type="button" aria-label="Drag to move this row" onMouseDown={() => setArmed(l.key)} onMouseUp={() => setArmed(null)} className="absolute -left-[22px] top-[14px] w-[16px] h-[22px] flex items-center justify-center text-[#c9cbd6] hover:text-[#6d7189] cursor-grab"><GripVertical className="w-4 h-4" /></button>
                      {i + 1}
                    </td>
                    <td className="relative pl-[14px] pr-[10px] py-[11px]">
                      <div className="flex items-start gap-[12px] lg:gap-[18px]">
                        <div className="mt-[4px]"><Thumb fileId={l.imageFileId} /></div>
                        <div className="flex-1 min-w-0">
                          <div className="pr-[58px]">
                            <ItemPicker
                              id={`line-${i}-name`}
                              value={l.name}
                              linked={!!l.itemId}
                              invalid={!!err('name') || !!rowErr}
                              display={display}
                              canAdd={canAddItem}
                              onType={text => patch(l.key, { name: text, itemId: null, imageFileId: null })}
                              onPick={item => patch(l.key, { ...lineFromItem(item, l, defaultTax, interState), quantity: l.quantity || '1' })}
                              onAddNew={name => setItemWindow({ key: l.key, itemId: null, name })}
                            />
                          </div>
                          {(l.showDesc ?? !!l.description) && (
                            <textarea value={l.description} onChange={e => patch(l.key, { description: e.target.value })} rows={descRows(l.description)} maxLength={2000} aria-label="Item description" placeholder="Add a description to your item"
                              className={`${inputClass(!!err('description'))} !h-auto mt-[6px] !px-[14px] py-[10px] !text-[14px] leading-[24px] resize-y !rounded-[6px] ${err('description') ? '' : '!border-transparent !bg-[#f7f7f9] focus:!bg-white focus:!border-[#548df6]'}`} />
                          )}
                          <TaxCodeLine key={l.key} name={l.name} kind={l.kind || 'Service'} code={l.hsn} onChange={code => patch(l.key, { hsn: code })} allowToggle={true} onKindToggle={() => patch(l.key, { kind: (l.kind || 'Service') === 'Service' ? 'Goods' : 'Service' })} onChangeKind={k => patch(l.key, { kind: k })} />
                          {(err('name') || rowErr) && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{err('name') ?? rowErr}</p>}
                        </div>
                      </div>
                      <div className={`absolute right-[10px] top-[14px] flex items-center gap-[8px] ${filled ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                        <Menu align="right" width={190} trigger={({ toggle }) => (
                          <button type="button" onClick={toggle} aria-label="Row options" aria-haspopup="menu" className="w-[22px] h-[22px] rounded-full border border-[#c9cbd6] bg-white flex items-center justify-center text-[#7f8497] hover:bg-[#f1f1fa]"><MoreHorizontal className="w-3.5 h-3.5" /></button>
                        )}>
                          {close => (
                            <>
                              {l.itemId && canEditItem && <MenuItem onClick={() => { close(); setItemWindow({ key: l.key, itemId: l.itemId, name: l.name }); }}>Edit item</MenuItem>}
                              {(l.showDesc ?? !!l.description) ? (
                                <MenuItem onClick={() => { close(); patch(l.key, { showDesc: false }); }}>Hide description</MenuItem>
                              ) : (
                                <MenuItem onClick={() => { close(); patch(l.key, { showDesc: true }); }}>{l.description ? 'Show description' : 'Add description'}</MenuItem>
                              )}
                              <MenuItem onClick={() => { close(); clone(l, i); }}>Clone</MenuItem>
                              <MenuItem onClick={() => { close(); insert(i); }}>Insert new row above</MenuItem>
                              <MenuItem onClick={() => { close(); insert(i + 1); }}>Insert new row below</MenuItem>
                              <MenuItem onClick={() => { close(); setSwapWindow({ index: i }); }}>Swap</MenuItem>
                            </>
                          )}
                        </Menu>
                        <button type="button" onClick={() => remove(l.key)} aria-label="Remove this row" className="w-[22px] h-[22px] rounded-full border border-[#c9cbd6] bg-white flex items-center justify-center text-[#7f8497] hover:text-[#e5484d] hover:border-[#f3c2c4] hover:bg-[#fdeeee]"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                    {tpl && (
                      <td className="px-[8px] py-[10px] border-l border-[#ebeaf2]">
                        <Combo
                          htmlId={`line-${i}-taskTemplateId`}
                          value={l.taskTemplateId || null}
                          shown={l.taskTemplateName}
                          search={q => searchLookup('quotes', 'templates', q)}
                          onChange={(id, picked) => patch(l.key, { taskTemplateId: id ?? '', taskTemplateName: picked?.label ?? '' })}
                          placeholder="Click to select Name"
                          ariaLabel={tpl.label}
                          invalid={!!err('taskTemplateId')}
                          clearable
                          emptyText="No task templates found"
                          icon={<Search className="w-3 h-3 text-[#9ca0ab] shrink-0" aria-hidden />}
                        />
                        {err('taskTemplateId') && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{err('taskTemplateId')}</p>}
                      </td>
                    )}
                    {hsn && <td className="px-[4px] py-[8px]"><input value={l.hsn} onChange={e => patch(l.key, { hsn: digitsOnly(e.target.value) })} inputMode="numeric" autoComplete="off" aria-label="HSN/SAC" className={`${cell} ${err('hsn') ? '!border-[#e5484d]' : ''}`} /></td>}
                    {unit && <td className="px-[4px] py-[8px]"><input value={l.unit} onChange={e => patch(l.key, { unit: e.target.value })} maxLength={20} aria-label="Unit" className={`${cell} ${err('unit') ? '!border-[#e5484d]' : ''}`} /></td>}
                    {custom.map(c => (
                      <td key={c.key} className="px-[4px] py-[8px]">
                        <QField f={c} compact id={`line-${i}-${c.key}`} value={l.custom[c.key] ?? (c.type === 'FILE' ? [] : '')} onChange={v => patch(l.key, { custom: { ...l.custom, [c.key]: v } })} error={errors[`lines.${i}.custom.${c.key}`]} ctx={ctx} />
                      </td>
                    ))}
                    {qty && (
                      <td className="px-[4px] py-[8px] border-l border-[#ebeaf2]">
                        <input value={l.quantity} onChange={e => patch(l.key, { quantity: e.target.value })} inputMode="decimal" aria-label="Quantity" aria-invalid={!!err('quantity') || undefined} className={`${cell} text-right text-[#222529] ${err('quantity') ? '!border-[#e5484d]' : ''}`} />
                        {!unit && !isBlankLine(l) && (
                          <div className="px-[2px] pt-[1px] flex justify-end">
                            <div className="relative inline-block group/unit">
                              <select
                                value={l.unit || ''}
                                onChange={e => patch(l.key, { unit: e.target.value })}
                                className={`text-[13px] leading-[18px] bg-transparent hover:bg-[#f1f1fa] rounded-[4px] pl-[6px] py-[2px] cursor-pointer outline-none appearance-none pr-[16px] text-right ${l.unit ? 'text-black' : 'text-[#9ca0ab]'}`}
                                title="Change Unit"
                              >
                                <option value="">Select unit</option>
                                {Array.from(new Set(['nos', 'sqft', 'sqmt', 'rft', 'kg', 'g', 'ltr', 'm', 'cm', 'mm', 'hours', 'days', 'months', 'pkt', 'box', 'set', 'roll', l.unit].filter(Boolean))).map(u => (
                                  <option key={u} value={u}>{u}</option>
                                ))}
                              </select>
                              <ChevronDown className="w-3 h-3 text-[#9ca0ab] absolute right-[2px] top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover/unit:opacity-100" />
                            </div>
                          </div>
                        )}
                        {err('quantity') && <p role="alert" className="text-[12px] text-[#d9232b] text-right">{err('quantity')}</p>}
                      </td>
                    )}
                    {rate && (
                      <td className="px-[4px] py-[8px] border-l border-[#ebeaf2]">
                        <input value={l.rate} onChange={e => patch(l.key, { rate: e.target.value })} inputMode="decimal" placeholder="0.00" aria-label="Rate" aria-invalid={!!err('rate') || undefined} className={`${cell} text-right ${err('rate') ? '!border-[#e5484d]' : ''}`} />
                        {!unit && l.unit && <div className="px-[8px] pt-[3px] text-right text-[12px] leading-[18px] text-[#6d7189]" data-line-per>per {l.unit}</div>}
                        {err('rate') && <p role="alert" className="text-[12px] text-[#d9232b] text-right">{err('rate')}</p>}
                      </td>
                    )}
                    {tax && (
                      <td className="px-[4px] py-[8px] border-l border-[#ebeaf2]">
                        <div className="relative">
                          <select value={l.taxId} onChange={e => patch(l.key, { taxId: e.target.value })} aria-label="Tax" className={`w-full h-[34px] pl-[8px] pr-7 lg:pl-[10px] lg:pr-8 text-[12px] lg:text-[13px] rounded-[4px] border appearance-none bg-[#f9f9fb] focus:outline-none focus:border-[#548df6] ${err('taxId') ? 'border-[#e5484d]' : 'border-transparent hover:border-[#d7d5e1]'} ${l.taxId ? 'text-[#22263b]' : 'text-[#9ca0ab]'}`}>
                            <option value="">Select a Tax</option>
                            {taxOptions(l.taxId).map(t => <option key={t.id} value={t.id}>{t.name} [{t.rate}%]</option>)}
                          </select>
                          <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6d7189] pointer-events-none" aria-hidden />
                        </div>
                      </td>
                    )}
                    {amount && <td className="relative px-[6px] lg:px-[10px] py-[10px] border-l border-[#ebeaf2] text-right text-[13px] font-semibold text-black pt-[18px]" data-line-amount>{formatAmount(amounts[i] ?? 0, display.grouping)}</td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td colSpan={colCount} className="p-0 h-0" /></tr></tfoot>
          </table>
        </div>
        </div>
      </div>

      <div className="mt-[20px] ml-[20px] mr-[20px] lg:mr-[125px] flex flex-col lg:flex-row lg:items-stretch justify-between gap-[30px]">
      <div className="min-w-0 flex-1 flex flex-col justify-between gap-6">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <div className="inline-flex h-[32px] rounded-[4px] bg-[#f1f1fa] text-[13px] font-medium text-[#22263b]">
          <button type="button" onClick={() => setLines(cur => [...cur, blankLine(defaultTax)])} className="inline-flex items-center gap-[8px] px-[12px] whitespace-nowrap hover:bg-[#e8e8f6] rounded-l-[4px]"><Plus className="w-4 h-4 rounded-full bg-[#548df6] text-white p-[2px]" /> Add New Row</button>
          <Menu align="left" width={170} trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="More ways to add rows" aria-haspopup="menu" className="h-full w-9 flex items-center justify-center border-l border-white hover:bg-[#e8e8f6] rounded-r-[4px] text-[#6d7189]"><ChevronDown className="w-4 h-4" /></button>
          )}>
            {close => <MenuItem onClick={() => { close(); setLines(cur => [...cur, ...Array.from({ length: 5 }, () => blankLine(defaultTax))]); }}>Add 5 new rows</MenuItem>}
          </Menu>
        </div>
        <button type="button" onClick={() => setBulk(true)} className="inline-flex items-center gap-[8px] h-[32px] px-[12px] whitespace-nowrap rounded-[4px] bg-[#f1f1fa] hover:bg-[#e8e8f6] text-[13px] font-medium text-[#22263b]"><Plus className="w-4 h-4 rounded-full bg-[#548df6] text-white p-[2px]" /> Add Items in Bulk</button>
      </div>
      {below}
      </div>
      {aside && <div className="w-full lg:w-[520px] lg:mr-[9px] shrink-0">{aside}</div>}
      </div>

      {bulk && <BulkModal display={display} onClose={() => setBulk(false)} onAdd={items => { addMany(items); setBulk(false); }} />}
      {swapWindow && (
        <SwapModal
          currentIndex={swapWindow.index}
          max={lines.length}
          onClose={() => setSwapWindow(null)}
          onSwap={targetIndex => { swap(swapWindow.index, targetIndex); setSwapWindow(null); }}
        />
      )}
      {itemWindow && (
        <ItemOverlay
          itemId={itemWindow.itemId}
          initialName={itemWindow.name}
          taxes={settings.taxes}
          onClose={() => setItemWindow(null)}
          onSaved={(after, before) => {
            const target = itemWindow.key;
            // a changed item refreshes every row made from it with what each row still had as the Item Master had it (a rate or a description changed on this
            // quote stays); a new item fills the row it was added from
            setLines(cur => cur.map(l => (before ? (l.itemId === after.id ? syncLineWithItem(l, before, after, defaultTax, interState) : l) : l.key === target ? { ...lineFromItem(after, l, defaultTax, interState), quantity: l.quantity || '1' } : l)));
            setItemWindow(null);
          }}
        />
      )}
    </div>
  );
}
