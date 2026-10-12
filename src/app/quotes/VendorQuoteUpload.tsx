'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, FileUp, Plus, Trash2, X } from 'lucide-react';
import { ApiError, callApi } from '@/lib/leads/client';
import type { ItemDto } from '@/lib/quotes/types';
import {
  EXISTING_ACTIONS, NEW_ACTIONS, isEmptyVendorRow, normName, parseProfitPercent, round2, sellingRate, strictNumber, validateVendorRows, withEdited,
  type RowProblems, type VendorAction, type VendorApplyResult, type VendorApplyRow, type VendorMatch, type VendorRow,
} from '@/lib/quotes/vendor-quote';
import { VENDOR_FILE_TYPES, extractVendorQuote } from '@/lib/quotes/vendor-extract/read';
import { newRowKey } from '@/lib/quotes/vendor-extract/table';
import { Button, Modal, Spinner, inputClass } from './ui';

export type VendorOutcome = { rows: VendorRow[]; results: VendorApplyResult[]; items: Record<string, ItemDto>; fileName: string };

type Props = {
  profitPercent: string;
  onProfitChange: (v: string) => void;
  profitError?: string;
  manualRates: number; // rows whose selling rate was typed by hand (a new percentage leaves them alone)
  inQuote: Set<string>; // compared names of the rows that came from a vendor quote and are on the quote already
  canCreate: boolean; // may add items to the Items module
  canEdit: boolean; // may change items of the Items module
  disabled?: boolean;
  onApplied: (outcome: VendorOutcome) => void;
};

const money = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blankRow = (): VendorRow => ({ key: newRowKey(), name: '', description: '', quantity: '1', rate: '', amount: '', unit: '' });
const cellClass = (bad?: boolean, extra = '') => inputClass(!!bad, extra);

// ---------------------------------------------------------------------------
// The two controls placed next to Task Person
// ---------------------------------------------------------------------------
export default function VendorQuoteUpload(props: Props) {
  const { profitPercent, onProfitChange, profitError, manualRates, disabled } = props;
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [readError, setReadError] = useState('');
  const [review, setReview] = useState<{ fileName: string; rows: VendorRow[]; warnings: string[]; source: string } | null>(null);

  const pick = async (file: File) => {
    setReadError('');
    setReading('Reading the file…');
    try {
      const res = await extractVendorQuote(file, m => setReading(m));
      const rows = res.rows.length ? res.rows : [blankRow()];
      const warnings = [...res.warnings];
      if (!res.rows.length) warnings.push('No items could be found in this file. Type the items below, or check the file and upload it again.');
      setReview({ fileName: file.name, rows, warnings, source: res.source });
    } catch (e) {
      setReadError(e instanceof Error && e.message ? e.message : 'This file could not be read.');
    } finally {
      setReading(null);
    }
  };

  return (
    <div className="flex flex-col gap-[10px] pt-[2px]" data-vendor-upload>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          ref={fileInput}
          type="file"
          accept={VENDOR_FILE_TYPES}
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pick(f); }}
        />
        <Button kind="ghost" onClick={() => fileInput.current?.click()} disabled={disabled || reading !== null} title="Read the items of a vendor's quotation (PDF, Excel, CSV or a picture)">
          {reading !== null ? <Spinner className="w-3.5 h-3.5" /> : <FileUp className="w-3.5 h-3.5" />} Upload Vendor Quote
        </Button>
        {reading !== null && <span className="text-[12px] text-[#6d7189]" role="status">{reading}</span>}
      </div>
      {readError && (
        <p role="alert" className="max-w-[329px] flex items-start gap-1.5 text-[12px] text-[#b42318]"><AlertCircle className="w-3.5 h-3.5 mt-[2px] shrink-0" />{readError}</p>
      )}

      <div>
        <label htmlFor="f-profitPercent" className="block text-[13px] text-[#22263b] mb-[4px]">Profit Percentage (%)</label>
        <div className="relative w-[160px]">
          <input
            id="f-profitPercent"
            value={profitPercent}
            onChange={e => onProfitChange(e.target.value)}
            inputMode="decimal"
            placeholder="e.g. 25"
            maxLength={7}
            aria-invalid={!!profitError || undefined}
            aria-describedby="profit-hint"
            className={inputClass(!!profitError, 'pr-7 text-right')}
          />
          <span className="absolute right-[10px] top-[8px] text-[13px] text-[#7f8497] pointer-events-none" aria-hidden>%</span>
        </div>
        {profitError
          ? <p role="alert" className="mt-1 text-[12px] text-[#d9232b] max-w-[260px]">{profitError}</p>
          : <p id="profit-hint" className="mt-1 text-[12px] text-[#6d7189] max-w-[260px]">Selling rate = vendor rate × (1 + percentage ÷ 100), for the rows from a vendor quote.{manualRates > 0 ? ` ${manualRates} row${manualRates === 1 ? ' keeps' : 's keep'} a selling rate typed by hand.` : ''}</p>}
      </div>

      {review && (
        <ReviewDialog
          {...props}
          initial={review}
          onClose={() => setReview(null)}
          onApplied={outcome => { setReview(null); props.onApplied(outcome); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The window with the rows of the file
// ---------------------------------------------------------------------------
export function ReviewDialog({ initial, profitPercent, inQuote, canCreate, canEdit, onClose, onApplied }: Props & { initial: { fileName: string; rows: VendorRow[]; warnings: string[]; source: string }; onClose: () => void }) {
  const [rows, setRows] = useState<VendorRow[]>(initial.rows);
  const [problems, setProblems] = useState<Record<string, RowProblems>>({});
  const [banner, setBanner] = useState('');
  const [matches, setMatches] = useState<Record<string, VendorMatch>>({});
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [matchFailed, setMatchFailed] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [discard, setDiscard] = useState(false);
  const startJSON = useRef(JSON.stringify(initial.rows.map(r => [r.name, r.description, r.quantity, r.rate, r.amount])));
  const dirty = JSON.stringify(rows.map(r => [r.name, r.description, r.quantity, r.rate, r.amount])) !== startJSON.current;

  // E / N: the names that were not asked about yet are checked against the Items module (a moment after the last key stroke)
  const [recheck, setRecheck] = useState(0);
  useEffect(() => {
    const need = Array.from(new Set(rows.map(r => normName(r.name)).filter(k => k && !asked.has(k))));
    if (!need.length) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await callApi<{ matches: Record<string, VendorMatch> }>('/api/quotes/vendor-quote/match', 'POST', { names: need.slice(0, 200) });
        if (!live) return;
        setMatches(m => ({ ...m, ...res.matches }));
        setAsked(a => new Set([...a, ...need.slice(0, 200)]));
        setMatchFailed(false);
      } catch {
        if (live) setMatchFailed(true);
      }
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [rows, asked, recheck]);

  const matchOf = (r: VendorRow): VendorMatch | undefined => matches[normName(r.name)];
  const kindOf = (r: VendorRow): 'E' | 'N' | '?' | '' => {
    const k = normName(r.name);
    if (!k) return '';
    if (!asked.has(k)) return '?';
    return matches[k] ? 'E' : 'N';
  };

  const edit = (key: string, patch: Partial<VendorRow>) => {
    setRows(cur => cur.map(r => (r.key === key ? { ...r, ...patch } : r)));
    setProblems(cur => { if (!cur[key]) return cur; const { [key]: _gone, ...rest } = cur; void _gone; return rest; });
    setBanner('');
  };
  const editNumber = (key: string, field: 'quantity' | 'rate' | 'amount', v: string) => {
    setRows(cur => cur.map(r => (r.key === key ? withEdited(r, field, v) : r)));
    setProblems(cur => { if (!cur[key]) return cur; const { [key]: _gone, ...rest } = cur; void _gone; return rest; });
    setBanner('');
  };

  const filled = rows.filter(r => !isEmptyVendorRow(r));
  const total = filled.reduce((a, r) => a + (strictNumber(r.amount) ?? 0), 0);

  // ---- Save -> the window with the choices
  const [pendingCheck, setPendingCheck] = useState(false);
  const save = async () => {
    setBanner('');
    if (!filled.length) { setBanner('Add at least one item before saving.'); return; }
    const found = validateVendorRows(filled);
    setProblems(found);
    if (Object.keys(found).length) {
      setBanner('Please correct the cells marked in red.');
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-vendor-bad="1"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return;
    }
    if (parseProfitPercent(profitPercent) === null) { setBanner('The Profit Percentage must be a number from 0 to 1000. Correct it on the quote first.'); return; }
    // every name must have been checked against the Items module: the choices depend on it
    if (filled.some(r => kindOf(r) === '?')) {
      setPendingCheck(true);
      try {
        const names = Array.from(new Set(filled.map(r => normName(r.name)).filter(k => !asked.has(k))));
        const res = await callApi<{ matches: Record<string, VendorMatch> }>('/api/quotes/vendor-quote/match', 'POST', { names });
        setMatches(m => ({ ...m, ...res.matches }));
        setAsked(a => new Set([...a, ...names]));
        setMatchFailed(false);
      } catch {
        setMatchFailed(true);
        setBanner('The items could not be checked against the Items module. Check your connection and try again.');
        return;
      } finally {
        setPendingCheck(false);
      }
    }
    setConfirm(true);
  };

  const close = () => { if (dirty) setDiscard(true); else onClose(); };

  return (
    <>
      <div className="fixed inset-0 z-[100] flex items-start sm:items-center justify-center bg-[rgba(34,38,59,0.45)] p-3 overflow-y-auto">
        <div role="dialog" aria-modal="true" aria-labelledby="vq-title" className="w-full max-w-[1100px] bg-white rounded-[8px] shadow-[0_12px_40px_rgba(34,38,59,0.25)] my-auto text-[#22263b]">
          <div className="flex items-center justify-between gap-3 px-5 h-[52px] border-b border-[#ebeaf2]">
            <h2 id="vq-title" className="text-[16px] font-semibold truncate">Vendor Quote · {initial.fileName}</h2>
            <button type="button" onClick={close} aria-label="Close" className="w-7 h-7 flex items-center justify-center rounded text-[#e5484d] hover:bg-[#fdeeee]"><X className="w-5 h-5" /></button>
          </div>

          <div className="px-5 py-4 max-h-[calc(100vh-190px)] overflow-y-auto">
            <p className="text-[13px] text-[#6d7189] mb-3">
              Check what was read from the file and correct anything that is wrong. <b className="text-[#22263b] font-semibold">E</b> = already an item of the Items module (same name),{' '}
              <b className="text-[#22263b] font-semibold">N</b> = a new item. The rates are the vendor&apos;s rates{parseProfitPercent(profitPercent) ? `; the profit percentage of ${parseProfitPercent(profitPercent)}% is added when the rows go to the quote` : ''}.
            </p>
            {initial.warnings.map((w, i) => (
              <div key={i} className="mb-2 flex items-start gap-2 rounded-[4px] border border-[#f5d9a8] bg-[#fff8e6] px-3 py-2 text-[13px] text-[#8a5a00]"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /><span>{w}</span></div>
            ))}
            {matchFailed && (
              <div className="mb-2 flex items-start gap-2 rounded-[4px] border border-[#f3c2c4] bg-[#fdeeee] px-3 py-2 text-[13px] text-[#b42318]">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>The names could not be checked against the Items module. <button type="button" className="underline" onClick={() => setRecheck(n => n + 1)}>Try again</button></span>
              </div>
            )}
            {banner && <div role="alert" className="mb-2 flex items-start gap-2 rounded-[4px] border border-[#f3c2c4] bg-[#fdeeee] px-3 py-2 text-[13px] text-[#b42318]"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{banner}</span></div>}

            <div className="overflow-x-auto border border-[#ebeaf2] rounded-[6px]">
              <table className="w-full min-w-[860px] text-[13px] border-collapse">
                <thead>
                  <tr className="bg-[#f9f9fb] text-left text-[12px] font-semibold text-[#22263b]">
                    <th className="px-3 py-2 w-[92px]">Serial Number</th>
                    <th className="px-2 py-2 min-w-[220px]">Item Details</th>
                    <th className="px-2 py-2 min-w-[220px]">Description</th>
                    <th className="px-2 py-2 w-[96px] text-right">Quantity</th>
                    <th className="px-2 py-2 w-[116px] text-right">Rate</th>
                    <th className="px-2 py-2 w-[126px] text-right">Total Amount</th>
                    <th className="w-[44px]" aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const p = problems[r.key] ?? {};
                    const kind = kindOf(r);
                    const match = matchOf(r);
                    const known = inQuote.has(normName(r.name));
                    const bad = Object.keys(p).length > 0;
                    return (
                      <tr key={r.key} className="border-t border-[#ebeaf2] align-top" data-vendor-bad={bad ? '1' : undefined}>
                        <td className="px-3 py-[10px]">
                          <div className="flex items-center gap-2">
                            <span className="w-4 text-[#7f8497]">{i + 1}</span>
                            {kind && (
                              <span
                                title={kind === 'E' ? `Existing item in the Items module: ${match?.item.name}${(match?.duplicates ?? 1) > 1 ? ` (${match?.duplicates} items have this name)` : ''}` : kind === 'N' ? 'New item: no item of the Items module has this name' : 'Checking the Items module…'}
                                aria-label={kind === 'E' ? 'Existing item' : kind === 'N' ? 'New item' : 'Checking'}
                                className={`inline-flex w-[22px] h-[22px] rounded-full items-center justify-center text-[11px] font-bold ${kind === 'E' ? 'bg-[#e3f6ea] text-[#16794a] border border-[#9bd8b5]' : kind === 'N' ? 'bg-[#fff1d6] text-[#9a5b00] border border-[#f1cf8e]' : 'bg-[#f1f1fa] text-[#7f8497]'}`}
                              >{kind === '?' ? '…' : kind}</span>
                            )}
                          </div>
                          {known && <span title="This item is on the quote already: it will be updated, not added again" className="mt-1 inline-block text-[10px] text-[#548df6]">In quote</span>}
                        </td>
                        <td className="px-2 py-[7px]">
                          <input value={r.name} onChange={e => edit(r.key, { name: e.target.value })} aria-label={`Item details, row ${i + 1}`} aria-invalid={!!p.name || undefined} className={cellClass(!!p.name)} />
                          {p.name && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{p.name}</p>}
                        </td>
                        <td className="px-2 py-[7px]">
                          <textarea value={r.description} onChange={e => edit(r.key, { description: e.target.value })} rows={1} aria-label={`Description, row ${i + 1}`} className={`${cellClass(!!p.description)} h-auto min-h-[34px] py-[7px] resize-y leading-[18px]`} />
                          {p.description && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{p.description}</p>}
                        </td>
                        <td className="px-2 py-[7px]">
                          <input value={r.quantity} onChange={e => editNumber(r.key, 'quantity', e.target.value)} inputMode="decimal" aria-label={`Quantity, row ${i + 1}`} aria-invalid={!!p.quantity || undefined} className={cellClass(!!p.quantity, 'text-right')} />
                          {p.quantity && <p role="alert" className="mt-1 text-[12px] text-[#d9232b] text-right">{p.quantity}</p>}
                        </td>
                        <td className="px-2 py-[7px]">
                          <input value={r.rate} onChange={e => editNumber(r.key, 'rate', e.target.value)} inputMode="decimal" aria-label={`Rate, row ${i + 1}`} aria-invalid={!!p.rate || undefined} className={cellClass(!!p.rate, 'text-right')} />
                          {p.rate && <p role="alert" className="mt-1 text-[12px] text-[#d9232b] text-right">{p.rate}</p>}
                        </td>
                        <td className="px-2 py-[7px]">
                          <input value={r.amount} onChange={e => editNumber(r.key, 'amount', e.target.value)} inputMode="decimal" aria-label={`Total amount, row ${i + 1}`} aria-invalid={!!p.amount || undefined} className={cellClass(!!p.amount, 'text-right')} />
                          {p.amount && <p role="alert" className="mt-1 text-[12px] text-[#d9232b] text-right">{p.amount}</p>}
                        </td>
                        <td className="px-1 py-[7px] text-center">
                          <button type="button" onClick={() => setRows(cur => (cur.length > 1 ? cur.filter(x => x.key !== r.key) : [blankRow()]))} aria-label={`Remove row ${i + 1}`} className="w-8 h-8 inline-flex items-center justify-center rounded text-[#7f8497] hover:text-[#e5484d] hover:bg-[#fdeeee]"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <Button kind="ghost" onClick={() => setRows(cur => [...cur, blankRow()])}><Plus className="w-3.5 h-3.5" /> Add Row</Button>
              <span className="text-[13px] text-[#6d7189]">{filled.length} row{filled.length === 1 ? '' : 's'} · vendor total <b className="text-[#22263b]">{money(round2(total))}</b></span>
            </div>
          </div>

          <div className="px-5 py-3 border-t border-[#ebeaf2] flex flex-wrap items-center justify-end gap-2">
            {discard ? (
              <>
                <span className="mr-auto text-[13px] text-[#b42318]">Discard the rows read from the file?</span>
                <Button onClick={() => setDiscard(false)}>Keep Editing</Button>
                <Button kind="danger" onClick={onClose}>Discard</Button>
              </>
            ) : (
              <>
                <Button onClick={close}>Cancel</Button>
                <Button kind="blue" onClick={save} busy={pendingCheck}>Save</Button>
              </>
            )}
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmSave
          rows={filled}
          matches={matches}
          profitPercent={profitPercent}
          canCreate={canCreate}
          canEdit={canEdit}
          onBack={() => setConfirm(false)}
          onStale={message => { setConfirm(false); setBanner(message); setAsked(new Set()); setMatches({}); }}
          onDone={(results, items) => onApplied({ rows: filled, results, items, fileName: initial.fileName })}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// The choices for Existing and New items
// ---------------------------------------------------------------------------
export function ConfirmSave({ rows, matches, profitPercent, canCreate, canEdit, onBack, onStale, onDone }: {
  rows: VendorRow[];
  matches: Record<string, VendorMatch>;
  profitPercent: string;
  canCreate: boolean;
  canEdit: boolean;
  onBack: () => void;
  onStale: (message: string) => void;
  onDone: (results: VendorApplyResult[], items: Record<string, ItemDto>) => void;
}) {
  const existing = rows.filter(r => matches[normName(r.name)]);
  const fresh = rows.filter(r => !matches[normName(r.name)]);
  const [existingChoice, setExistingChoice] = useState<VendorAction>(canEdit ? 'update' : 'keep');
  const [newChoice, setNewChoice] = useState<VendorAction>(canCreate ? 'add' : 'quote-only');
  const [each, setEach] = useState<Record<string, VendorAction>>({});
  const [open, setOpen] = useState<{ existing: boolean; fresh: boolean }>({ existing: false, fresh: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pct = parseProfitPercent(profitPercent) ?? 0;
  const actionOf = (r: VendorRow, group: 'existing' | 'fresh'): VendorAction => each[r.key] ?? (group === 'existing' ? existingChoice : newChoice);
  const allowed = (a: VendorAction) => (a === 'update' ? canEdit : a === 'add' ? canCreate : true);

  const apply = async () => {
    setError('');
    setSaving(true);
    const payload: VendorApplyRow[] = [
      ...existing.map(r => ({ r, a: actionOf(r, 'existing') })),
      ...fresh.map(r => ({ r, a: actionOf(r, 'fresh') })),
    ].map(({ r, a }) => {
      const rate = strictNumber(r.rate) ?? 0;
      return { key: r.key, action: a, itemId: matches[normName(r.name)]?.item.id ?? null, name: r.name, description: r.description, rate, sellingRate: sellingRate(rate, pct), unit: r.unit };
    });
    try {
      const res = await callApi<{ results: VendorApplyResult[]; items: Record<string, ItemDto> }>('/api/quotes/vendor-quote/apply', 'POST', { rows: payload });
      onDone(res.results, res.items);
    } catch (e) {
      // nothing was changed (the save is all or nothing): the reviewed rows stay, and the person can try again
      if (e instanceof ApiError && e.status === 409) onStale(e.message);
      else { setError(e instanceof Error && e.message ? e.message : 'The items could not be saved.'); setSaving(false); }
    }
  };

  const group = (title: string, count: number, kind: 'existing' | 'fresh', list: VendorRow[], options: typeof EXISTING_ACTIONS, value: VendorAction, set: (a: VendorAction) => void): ReactNode => (
    <section className="rounded-[6px] border border-[#ebeaf2]" aria-labelledby={`vq-g-${kind}`}>
      <h3 id={`vq-g-${kind}`} className="px-4 py-2 bg-[#f9f9fb] border-b border-[#ebeaf2] text-[13px] font-semibold">{title} <span className="font-normal text-[#6d7189]">({count})</span></h3>
      <div className="px-4 py-3 space-y-2">
        {options.map(o => (
          <label key={o.id} className={`flex items-start gap-2 text-[13px] ${allowed(o.id) ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}>
            <input type="radio" name={`vq-${kind}`} checked={value === o.id} disabled={!allowed(o.id) || saving} onChange={() => { set(o.id); setEach(cur => Object.fromEntries(Object.entries(cur).filter(([k]) => !list.some(r => r.key === k)))); }} className="mt-[3px] accent-[#548df6]" />
            <span><b className="font-medium">{o.label}</b><span className="block text-[12px] text-[#6d7189]">{allowed(o.id) ? o.hint : `You do not have permission to ${o.id === 'update' ? 'change' : 'add'} items`}</span></span>
          </label>
        ))}
        <button type="button" onClick={() => setOpen(cur => ({ ...cur, [kind]: !cur[kind] }))} className="text-[12px] text-[#548df6] hover:underline">{open[kind] ? 'Hide the items' : 'Choose for each item'}</button>
        {open[kind] && (
          <ul className="max-h-[160px] overflow-y-auto divide-y divide-[#f1f1fa] border border-[#ebeaf2] rounded-[4px]">
            {list.map(r => (
              <li key={r.key} className="flex items-center justify-between gap-3 px-3 py-[6px] text-[13px]">
                <span className="truncate">{r.name}</span>
                <select value={actionOf(r, kind)} disabled={saving} onChange={e => setEach(cur => ({ ...cur, [r.key]: e.target.value as VendorAction }))} aria-label={`What to do with ${r.name}`} className="h-[28px] rounded-[4px] border border-[#d7d5e1] bg-white text-[12px]">
                  {options.map(o => <option key={o.id} value={o.id} disabled={!allowed(o.id)}>{o.label}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );

  return (
    <Modal
      title="Save Vendor Quote Items"
      onClose={onBack}
      width={620}
      busy={saving}
      footer={(
        <>
          <Button onClick={onBack} disabled={saving}>Back</Button>
          <Button kind="blue" onClick={apply} busy={saving}>{error ? 'Try Again' : 'Confirm and Add to Quote'}</Button>
        </>
      )}
    >
      <div className="space-y-3">
        {existing.length > 0 && group('Existing Items', existing.length, 'existing', existing, EXISTING_ACTIONS, existingChoice, setExistingChoice)}
        {fresh.length > 0 && group('New Items', fresh.length, 'fresh', fresh, NEW_ACTIONS, newChoice, setNewChoice)}
        <p className="text-[12px] text-[#6d7189]">
          The rows are added to the quote in every case. What is chosen above changes the Items module <b className="font-medium">now</b>; it stays even if you leave this quote without saving it.
          New items are created with the vendor rate as the cost price, the selling rate of the quote as the price, the default tax and the unit of the file (or nos); add the HSN/SAC and Task Template in the Items module.
        </p>
        {error && <div role="alert" className="flex items-start gap-2 rounded-[4px] border border-[#f3c2c4] bg-[#fdeeee] px-3 py-2 text-[13px] text-[#b42318]"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error} Your rows are kept; nothing was changed.</span></div>}
      </div>
    </Modal>
  );
}
