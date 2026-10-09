'use client';

import { useState } from 'react';
import { Calendar, Check, ChevronUp, Clock, List, Loader2, MapPin, Pencil, Phone, Tag, User, X } from 'lucide-react';
import { isHttpUrl, formatRupees } from '@/lib/leads/format';
import type { LeadRow } from '@/lib/leads/queries';
import { callApi } from '@/lib/leads/client';
import type { LeadOptionDto, LeadStatusText } from '@/lib/leads/constants';
import { useToast } from '@/components/ui/Toast';

const label = 'text-[10px] font-semibold uppercase tracking-wide text-gray-500';
const box = 'w-full border border-gray-300 rounded px-2 py-0.5 text-[12px] text-gray-800 bg-white min-h-[26px] flex items-center';

// ---------------------------------------------------------------------------
// Inline edit: Amount, Lead Status, Location and Exact Location are edited right in the table. Each change is one
// request to PATCH /api/leads/:id/field (same permission, validation and audit trail as the lead form).
// ---------------------------------------------------------------------------
export type InlineContext = {
  leadStatuses: LeadOptionDto[];
  required: { amount: boolean; leadStatusId: boolean; location: boolean; exactLocation: boolean }; // from Edit Page Layout
  onSaved: () => void; // asks the page to reload its rows
  apiBase?: string; // where the rows' ids belong: '/api/leads' (default) or '/api/deals'
  statusNoun?: string; // what the status dropdown is called: 'Lead' (default) or 'Deal'
};
type FieldName = 'amount' | 'leadStatusId' | 'location' | 'exactLocation';
const saveField = (apiBase: string, rowId: string, field: FieldName, value: string | number | null) => callApi(`${apiBase}/${rowId}/field`, 'PATCH', { field, value });

// Keeps showing the value the user just saved until the table's own data (reloaded after the save) catches up
function useSaved<T>(current: T) {
  const [saved, setSaved] = useState<{ base: T; value: T } | null>(null);
  const shown = saved && Object.is(saved.base, current) ? saved.value : current;
  return [shown, (value: T) => setSaved({ base: current, value })] as const;
}

// Click the value to edit it. Enter or the tick saves, Esc or the cross cancels.
function InlineText({ apiBase = '/api/leads', rowId, field, value, numeric, canEdit, required, onSaved, label, maxLength, className, editPrefix, render }: {
  apiBase?: string; rowId: string; field: FieldName; value: string | number | null; numeric?: boolean; canEdit: boolean; required: boolean;
  onSaved: () => void; label: string; maxLength?: number; className: string; editPrefix?: React.ReactNode;
  render: (value: string | number | null) => React.ReactNode;
}) {
  const toast = useToast();
  const [shown, setShown] = useSaved(value);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!editing) {
    return (
      <button type="button" disabled={!canEdit} onClick={() => { setDraft(shown === null ? '' : String(shown)); setError(''); setEditing(true); }}
        title={canEdit ? `Click to edit ${label}` : undefined} aria-label={canEdit ? `Edit ${label}` : undefined}
        className={`${className} group text-left justify-between gap-1.5 ${canEdit ? 'cursor-text hover:border-[#f5b800]' : 'cursor-default'}`}>
        <span className="min-w-0 break-words">{render(shown)}</span>
        {canEdit && <Pencil className="w-3 h-3 text-gray-400 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 shrink-0" />}
      </button>
    );
  }

  const commit = async () => {
    const text = draft.trim();
    let next: string | number | null;
    if (numeric) {
      const n = Number(text);
      if (text !== '' && (!Number.isFinite(n) || n < 0)) { setError('Enter an amount of 0 or more'); return; }
      next = text === '' ? null : Math.round(n * 100) / 100;
    } else {
      next = text === '' ? null : text;
    }
    if (next === null && required) { setError(`${label} is required`); return; }
    if (next === shown) { setEditing(false); return; }
    setBusy(true);
    setError('');
    try {
      await saveField(apiBase, rowId, field, next);
      setShown(next);
      setEditing(false);
      onSaved();
      toast.success(`${label} updated`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center gap-1">
        {editPrefix && <span className="text-[12px] text-gray-700 shrink-0">{editPrefix}</span>}
        <input
          autoFocus
          type={numeric ? 'number' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          min={numeric ? 0 : undefined}
          step={numeric ? '0.01' : undefined}
          maxLength={maxLength}
          value={draft}
          disabled={busy}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          onChange={e => { setDraft(e.target.value); if (error) setError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } else if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}
          className="min-w-0 flex-1 border border-[#f5b800] rounded px-2 py-0.5 text-[12px] text-gray-800 bg-white focus:outline-none disabled:opacity-60"
        />
        <button type="button" onClick={() => void commit()} disabled={busy} aria-label={`Save ${label}`} title="Save" className="w-6 h-6 rounded bg-[#16a34a] hover:bg-[#15803d] text-white flex items-center justify-center shrink-0 disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={3} />}
        </button>
        <button type="button" onClick={() => setEditing(false)} disabled={busy} aria-label={`Cancel editing ${label}`} title="Cancel" className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 flex items-center justify-center shrink-0 disabled:opacity-60"><X className="w-3.5 h-3.5" /></button>
      </div>
      {error && <div role="alert" className="text-[11px] text-[#d9232b] mt-0.5">{error}</div>}
    </div>
  );
}

// Lead Status as a dropdown: picking an option saves it straight away, and goes back to the old one if the save fails
function InlineStatus({ row, current, canEdit, inline }: { row: LeadRow; current: { id: string; label: string } | null; canEdit: boolean; inline: InlineContext }) {
  const toast = useToast();
  const noun = inline.statusNoun ?? 'Lead';
  const [shownId, setShownId] = useSaved<string | null>(current?.id ?? null);
  const [busy, setBusy] = useState(false);
  const statuses = inline.leadStatuses;
  const labelOf = (id: string | null) => (id ? statuses.find(s => s.id === id)?.label ?? (id === current?.id ? current.label : null) : null) ?? '—';
  if (!canEdit) return <div className={box} title={`${noun} Status`}>{labelOf(shownId)}</div>;

  const change = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value || null;
    const previous = shownId;
    setShownId(next);
    setBusy(true);
    try {
      await saveField(inline.apiBase ?? '/api/leads', row.id, 'leadStatusId', next);
      inline.onSaved();
      toast.success(`${noun} status updated`);
    } catch (err) {
      setShownId(previous);
      toast.error(err instanceof Error ? err.message : `Could not update the ${noun.toLowerCase()} status`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <select value={shownId ?? ''} onChange={change} disabled={busy} aria-label={`${noun} status of ${row.code}`} title={`${noun} Status: click to change`}
      className={`${box} cursor-pointer hover:border-[#f5b800] focus:outline-none focus:border-[#f5b800] disabled:opacity-60`}>
      <option value="" disabled={inline.required.leadStatusId}>—</option>
      {current && !statuses.some(s => s.id === current.id) && <option value={current.id}>{current.label}</option>}
      {statuses.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select>
  );
}

export function LeadIdCell({ row }: { row: LeadRow }) {
  const badge = row.productOrServiceLabel ? row.productOrServiceLabel.trim()[0].toUpperCase() : '•';
  return (
    <div className="flex items-start gap-2.5">
      <span title={row.productOrServiceLabel ?? 'Product or Service not set'} className="w-6 h-6 rounded-full bg-[#f5b800] text-white text-[12px] font-bold flex items-center justify-center shrink-0">{badge}</span>
      <div className="space-y-0.5">
        <div className="text-[#d9232b] font-semibold text-[13px]">{row.code}</div>
        <div className="flex items-center gap-1.5 text-[12px] text-gray-600"><Calendar className="w-3.5 h-3.5 text-gray-500" fill="currentColor" />{row.date}</div>
        <div className="flex items-center gap-1.5 text-[12px] text-gray-600"><Clock className="w-3.5 h-3.5 text-gray-500" fill="currentColor" stroke="white" />{row.time}</div>
      </div>
    </div>
  );
}

// Also used by the Deals page, which carries the same customer details over
export function CustomerDetailsCell({ row }: { row: Pick<LeadRow, 'customerName' | 'contactNumber' | 'leadTypeLabel'> }) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 font-semibold text-[13px] text-[#333]"><User className="w-3.5 h-3.5 text-[#d9232b] shrink-0" fill="currentColor" />{row.customerName}</div>
      <div className="flex items-center gap-1.5 text-[12px] text-gray-600"><Phone className="w-3.5 h-3.5 text-gray-500 shrink-0" />{row.contactNumber || '—'}</div>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500"><Tag className="w-3 h-3 shrink-0" fill="currentColor" />{row.leadTypeLabel ?? 'Standard'}</div>
    </div>
  );
}

export function RequirementsCell({ row, canEdit, inline }: { row: LeadRow; canEdit: boolean; inline: InlineContext }) {
  return (
    <div className="space-y-1.5 max-w-[260px]">
      <div className="text-[13px] text-[#333] break-words line-clamp-3" title={row.exactRequirement ?? undefined}>{row.exactRequirement || '—'}</div>
      <InlineText apiBase={inline.apiBase} rowId={row.id} field="amount" value={row.amount} numeric canEdit={canEdit} required={inline.required.amount} onSaved={inline.onSaved} label="Amount"
        className="w-full flex items-center bg-gray-100 border border-gray-200 rounded px-2.5 py-1 text-[12px] text-gray-700" editPrefix="Amount: ₹"
        render={v => <>Amount: <span className="text-[#16a34a] font-bold ml-1">{formatRupees(v as number | null)}</span></>} />
    </div>
  );
}

export function StaffAssignmentCell({ row }: { row: Pick<LeadRow, 'leadPerson' | 'taskPerson'> }) {
  return (
    <div className="space-y-1.5">
      <div title="Lead Person" className="flex items-center gap-1.5 text-[13px] font-semibold text-[#333]">
        <User className="w-3.5 h-3.5 text-[#d9232b] shrink-0" fill="currentColor" /><span className="sr-only">Lead Person: </span>{row.leadPerson?.name ?? '—'}
      </div>
      <div title="Task Assigned Person" className="flex items-center gap-1.5 text-[12px] text-gray-600">
        <List className="w-3.5 h-3.5 shrink-0" /><span className="sr-only">Task Assigned Person: </span>{row.taskPerson?.name ?? '—'}
      </div>
    </div>
  );
}

// Lead Status box + inline notes ("Click to add notes"). The Deals page shows the same cell with the Deal Status (passed as `status`).
export function LeadStatusCell({ row, canEdit, inline, status }: { row: LeadRow; canEdit: boolean; inline: InlineContext; status?: { id: string; label: string } | null }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.notes ?? '');
  const [saved, setSaved] = useState<string | null>(row.notes);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await callApi(`${inline.apiBase ?? '/api/leads'}/${row.id}/notes`, 'PATCH', { notes: value.trim() || null });
      setSaved(value.trim() || null);
      setEditing(false);
      toast.success('Notes saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save notes');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1 w-full max-w-[230px]">
      <InlineStatus row={row} current={status === undefined ? row.leadStatus : status} canEdit={canEdit} inline={inline} />
      {editing ? (
        <div className="bg-gray-100 rounded p-2 space-y-2">
          <textarea autoFocus rows={3} maxLength={5000} value={value} onChange={e => setValue(e.target.value)} aria-label="Lead notes" className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:outline-none focus:border-[#f5b800]" />
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setValue(saved ?? ''); setEditing(false); }} className="px-2.5 py-1 text-[11px] rounded bg-gray-300 text-gray-800">Cancel</button>
            <button onClick={save} disabled={busy} className="px-2.5 py-1 text-[11px] rounded bg-black text-white disabled:opacity-60">{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canEdit}
          onClick={() => setEditing(true)}
          className={`w-full bg-gray-100 rounded px-2.5 py-1.5 text-left text-[12px] flex items-start justify-between gap-2 ${canEdit ? 'hover:bg-gray-200 cursor-pointer' : 'cursor-default'}`}
        >
          <span className={`whitespace-pre-line break-words ${saved ? 'text-gray-700' : 'text-gray-500'}`}>{saved ?? 'Click to add notes'}</span>
          {canEdit && <Pencil className="w-4 h-4 text-gray-600 shrink-0 mt-0.5" />}
        </button>
      )}
    </div>
  );
}

// Follow-up column: the green arrow opens "Upload Follow-up Proof"; the number is how many follow-ups were done and opens the list of them
export function FollowUpCell({ row, canEdit, onUpload, onView }: { row: LeadRow; canEdit: boolean; onUpload: () => void; onView: () => void }) {
  const when = (v: { date: string; time: string } | null) => (v ? <span className="text-gray-600">{v.date}<br />{v.time}</span> : <span className="text-gray-500">N/A</span>);
  return (
    <div className="flex flex-col items-center gap-1 text-[11px] text-gray-600 w-[120px]">
      <button type="button" onClick={onUpload} disabled={!canEdit} title={canEdit ? 'Upload follow-up proof' : 'You cannot add follow-ups'} aria-label={`Upload follow-up proof for ${row.code}`}
        className={`w-5 h-5 rounded-sm bg-[#16a34a] flex items-center justify-center ${canEdit ? 'hover:bg-[#15803d] cursor-pointer' : 'opacity-60 cursor-default'}`}>
        <ChevronUp className="w-4 h-4 text-white" strokeWidth={3} />
      </button>
      <button type="button" onClick={onView} disabled={row.followUpCount === 0} title={row.followUpCount ? 'View follow-ups and their files' : 'No follow-ups yet'} aria-label={`View ${row.followUpCount} ${row.followUpCount === 1 ? 'follow-up' : 'follow-ups'} of ${row.code}`}
        className={`flex items-center gap-1 text-[#d9232b] font-semibold ${row.followUpCount ? 'cursor-pointer hover:underline' : 'cursor-default'}`}><Phone className="w-3.5 h-3.5" fill="currentColor" />{row.followUpCount}</button>
      <div className="space-y-0.5 text-left">
        <div className="flex gap-1"><span className="text-[#d9232b]">●</span><span>Last: {when(row.lastFollowUp)}</span></div>
        <div className="flex gap-1"><span className="text-[#16a34a]">●</span><span>Next: {when(row.nextFollowUp)}</span></div>
      </div>
    </div>
  );
}

// Static for now: status workflow comes later. RATE is the real Conventional Rate.
const STATUS_STYLE: Record<LeadStatusText, string> = { Open: 'text-[#333]', 'Follow-up': 'font-semibold text-[#b45309]', Closed: 'font-semibold text-[#d9232b]' };

export function StatusCell({ rate, status }: { rate: number | null; status: LeadStatusText }) {
  const pct = Math.max(0, Math.min(100, rate ?? 0));
  return (
    <div className="w-[150px] space-y-1">
      <div><div className={label}>Status:</div><div className={`text-[15px] leading-tight ${STATUS_STYLE[status]}`}>{status}</div></div>
      <div>
        <div className={label}>Rate:</div>
        <div className="h-2 rounded bg-gray-200 overflow-hidden mt-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-[#f5b800]" style={{ width: `${pct}%` }} /></div>
        <div className={`${box} mt-1 py-0`}>{pct}%</div>
      </div>
    </div>
  );
}

export function SourceCell({ row }: { row: LeadRow }) {
  return (
    <div className="space-y-1 text-[12px]">
      <div className="text-gray-700">{row.modeOfCustomerLabel ?? '—'}</div>
    </div>
  );
}

// Main Category (red) and, under it, the Subcategory
export function CategoryCell({ row }: { row: LeadRow }) {
  return (
    <div className="space-y-0.5 max-w-[220px]">
      <div className="text-[13px] text-[#d9232b]">{row.mainCategoryLabel ?? '—'}</div>
      <div className="text-[12px] italic text-gray-500">{row.subcategoryLabel}</div>
    </div>
  );
}

export function LocationCell({ row, canEdit, inline }: { row: LeadRow; canEdit: boolean; inline: InlineContext }) {
  const link = row.locationLink && isHttpUrl(row.locationLink) ? row.locationLink : null;
  return (
    <div className="space-y-0.5 w-full max-w-[220px]">
      <div className={label}>Location:</div>
      <div className="flex items-center gap-1.5">
        <InlineText apiBase={inline.apiBase} rowId={row.id} field="location" value={row.location} canEdit={canEdit} required={inline.required.location} onSaved={inline.onSaved} label="Location" maxLength={200}
          className={box} render={v => (v as string | null) ?? 'N/A'} />
        {link && <a href={link} target="_blank" rel="noopener noreferrer" title="Open location link" className="text-[#2f80ed] shrink-0"><MapPin className="w-4 h-4" /></a>}
      </div>
      <div className={label}>Exact:</div>
      <InlineText apiBase={inline.apiBase} rowId={row.id} field="exactLocation" value={row.exactLocation} canEdit={canEdit} required={inline.required.exactLocation} onSaved={inline.onSaved} label="Exact Location" maxLength={300}
        className={box} render={v => (v as string | null) || 'N/A'} />
    </div>
  );
}
