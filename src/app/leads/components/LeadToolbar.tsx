'use client';

import { useState } from 'react';
import { Calendar, Download, Filter, LayoutTemplate, Plus, RefreshCw, Upload } from 'lucide-react';
import { DATE_FILTER_TYPES } from '@/lib/leads/constants';

const iconBtn = 'w-10 h-10 flex items-center justify-center text-gray-800 hover:text-black hover:bg-gray-100 rounded transition-colors';
const field = 'w-full border border-gray-300 rounded px-3 py-2 text-[13px] text-gray-800 bg-white focus:outline-none focus:border-yellow-500';

// The action icons of the Leads page (add, layout, refresh, filter = which date to filter by, calendar = the From / To range,
// download, import), shown on the summary / search row. The filter and calendar panels open right below the icons.
// The Deals page uses it too: no Add button (canCreate false), its own layout label, noun and list of dates, and no Import placeholder.
export default function LeadToolbar({
  params,
  canCreate,
  canExport,
  canImport = canCreate,
  canEditLayout,
  refreshing,
  onAdd,
  onEditLayout,
  onRefresh,
  onParams,
  onImport,
  exportHref,
  className = '',
  dateTypes = DATE_FILTER_TYPES,
  layoutLabel = 'Edit Page Layout',
  noun = 'leads',
  showImport = true,
}: {
  params: { from?: string; to?: string; dateBy?: string }; // the Leads, Deals and Projects pages each have their own list of dates
  canCreate: boolean;
  canExport: boolean;
  canImport?: boolean;
  canEditLayout: boolean; // Super Admin only
  refreshing: boolean;
  onAdd: () => void;
  onEditLayout: () => void;
  onRefresh: () => void;
  onParams: (u: Record<string, string | undefined>) => void;
  onImport?: () => void;
  exportHref: string;
  className?: string;
  dateTypes?: readonly { value: string; label: string }[]; // the first one is used when nothing else is picked
  layoutLabel?: string;
  noun?: string;
  showImport?: boolean;
}) {
  const [panel, setPanel] = useState<'filter' | 'date' | null>(null);
  const activeDates = [params.from, params.to].filter(Boolean).length;
  // The calendar's range applies to the date chosen with the funnel: the first one (Assigned Date) unless another one is picked
  const defaultType = dateTypes[0].value;
  const dateBy: string = params.dateBy ?? defaultType;
  const dateLabel = (dateTypes.find(d => d.value === dateBy) ?? dateTypes[0]).label;
  const [draft, setDraft] = useState({ from: params.from ?? '', to: params.to ?? '' }); // edited in the calendar, applied with Apply
  const toggle = (p: 'filter' | 'date') => {
    if (p === 'date' && panel !== 'date') setDraft({ from: params.from ?? '', to: params.to ?? '' }); // start from what is applied now
    setPanel(panel === p ? null : p);
  };
  const apply = () => {
    const [from, to] = draft.from && draft.to && draft.from > draft.to ? [draft.to, draft.from] : [draft.from, draft.to]; // a reversed range is put in order
    setPanel(null);
    onParams({ from: from || undefined, to: to || undefined });
  };
  const clearDates = () => { setPanel(null); onParams({ from: undefined, to: undefined, dateBy: undefined }); }; // also back to the first date
  const shown = (iso?: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : 'any');

  return (
    <div className={`relative flex items-center gap-1 sm:gap-2 ${className}`}>
      {canCreate && (
        <button onClick={onAdd} title="Add New Lead" aria-label="Add New Lead" className="w-10 h-10 flex items-center justify-center border-2 border-[#f5b800] rounded-[3px] text-[#f5b800] hover:bg-[#fff8dc] transition-colors">
          <Plus className="w-6 h-6" strokeWidth={2.5} />
        </button>
      )}
      {canEditLayout && (
        <button onClick={onEditLayout} title={layoutLabel} aria-label={layoutLabel} className={iconBtn}>
          <LayoutTemplate className="w-5 h-5" />
        </button>
      )}
      <button onClick={onRefresh} title="Refresh" aria-label="Refresh" className={iconBtn}><RefreshCw className={`w-5 h-5 ${refreshing ? 'animate-spin' : ''}`} /></button>
      <button onClick={() => toggle('filter')} title="Filter" aria-label="Filter" className={iconBtn}>
        <Filter className="w-5 h-5" fill="currentColor" />
      </button>
      <button onClick={() => toggle('date')} title={activeDates > 0 ? `${dateLabel}: ${shown(params.from)} to ${shown(params.to)}` : 'Select date range'} aria-label="Select date range" className={`${iconBtn} relative`}>
        <Calendar className="w-5 h-5" />
        {activeDates > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-[#d9232b]" />}
      </button>
      {canExport ? (
        <a href={exportHref} title="Download CSV" aria-label="Download CSV" className={iconBtn}><Download className="w-5 h-5" /></a>
      ) : (
        <span className={`${iconBtn} opacity-30 cursor-not-allowed`} title="You do not have permission to export"><Download className="w-5 h-5" /></span>
      )}
      {showImport && (
        canImport && onImport ? (
          <button
            type="button"
            onClick={onImport}
            title={`Import ${noun === 'deals' ? 'Deals' : 'Leads'} (CSV / XLSX)`}
            aria-label={`Import ${noun === 'deals' ? 'Deals' : 'Leads'}`}
            className={iconBtn}
          >
            <Upload className="w-5 h-5" />
          </button>
        ) : (
          <span
            className={`${iconBtn} opacity-30 cursor-not-allowed`}
            title={`You do not have permission to import ${noun}`}
            aria-disabled="true"
          >
            <Upload className="w-5 h-5" />
          </span>
        )
      )}

      {panel === 'filter' && (
        <div className="absolute right-0 top-12 z-30 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-4 space-y-3">
          <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide">Filter {noun}</div>
          <label className="block text-[12px] text-gray-600">Date to filter by
            <select className={`${field} mt-1`} value={dateBy} onChange={e => { setPanel(null); onParams({ dateBy: e.target.value === defaultType ? undefined : e.target.value }); }}>
              {dateTypes.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            <span className="block mt-1 text-[11px] text-gray-500">Then pick the From and To dates with the calendar icon.</span>
          </label>
        </div>
      )}
      {panel === 'date' && (
        <div className="absolute right-0 top-12 z-30 w-72 bg-white border border-gray-200 rounded-lg shadow-xl p-4 space-y-3">
          <div className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide">{dateLabel}</div>
          <label className="block text-[12px] text-gray-600">From
            <input type="date" className={`${field} mt-1`} value={draft.from} max={draft.to || undefined} onChange={e => setDraft(d => ({ ...d, from: e.target.value }))} />
          </label>
          <label className="block text-[12px] text-gray-600">To
            <input type="date" className={`${field} mt-1`} value={draft.to} min={draft.from || undefined} onChange={e => setDraft(d => ({ ...d, to: e.target.value }))} />
          </label>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" onClick={clearDates} disabled={activeDates === 0 && dateBy === defaultType && !draft.from && !draft.to} className="px-3 h-8 rounded text-[13px] text-gray-700 hover:bg-gray-100 disabled:opacity-40">Clear</button>
            <button type="button" onClick={apply} className="px-4 h-8 rounded bg-[#f5b800] text-black text-[13px] font-semibold hover:bg-[#e0a800]">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
