'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Loader2, Lock, ChevronDown, X } from 'lucide-react';
import { ApiError, callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import { MODULES } from '@/lib/records/registry';
import { cleanValue, defaultFor } from '@/lib/records/values';
import type { LayoutField, LookupItem, ModuleId, ModuleLayoutDto, RecordDto, RecordRefs } from '@/lib/records/types';
import { LayoutButton } from '../layout-editor/LayoutEditor';
import { api, initialValue, isBlankValue, toFormValue, toPayloadValue, type FormValues } from '../client';
import FieldInput, { type FieldCtx, pickedText } from './FieldInput';
import { VendorComboModal } from './VendorComboModal';
import TableSection, { newRow, type RowState } from './TableSection';

type Props = {
  moduleId: ModuleId;
  mode: 'create' | 'edit';
  layout: ModuleLayoutDto;
  record?: RecordDto;
  refs: RecordRefs;
  users: LookupItem[];
  approvers: LookupItem[];
  me: { id: string };
  canApprove: boolean;
  canLayout: boolean;
  nextCode: string;
  // Create PPR / Create PCR inside a project: the deal is the project's, shown and not changeable; Save goes to the project and comes back to it
  fromProject?: { id: string; code: string; dealId: string; dealLabel: string };
};

export function FieldRow({ f, children, error, htmlId }: { f: LayoutField; children: React.ReactNode; error?: string; htmlId: string }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[170px_minmax(0,1fr)] gap-x-4 gap-y-1.5 items-start" data-field={f.key}>
      <label htmlFor={htmlId} className="sm:text-right sm:pt-[9px] text-[14px] text-gray-700 leading-snug">
        {f.label}{f.required && <span className="text-[#d9232b]"> *</span>}
      </label>
      <div className="min-w-0">
        {children}
        {error && <p id={`${htmlId}-error`} role="alert" className="mt-1 text-[12px] text-[#d9232b]">{error}</p>}
      </div>
    </div>
  );
}

// The fields of a section in two columns, like the reference screens: the first half of the fields on the left, the rest on the right
export function TwoColumns<T>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const half = Math.ceil(items.length / 2);
  const cols = [items.slice(0, half), items.slice(half)];
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-4">
      {cols.map((col, i) => <div key={i} className="space-y-4 min-w-0">{col.map(render)}</div>)}
    </div>
  );
}

// Pre-Payment asks for the material vendor and the service vendor in one box ("Vendor Name"): one dialog, two tabs
function PrePaymentVendorCombo({ materialId, serviceId, onChange, ctx, slug, invalid, htmlId }: {
  materialId: string;
  serviceId: string;
  onChange: (materialId: string, serviceId: string, materialLabel: string, serviceLabel: string) => void;
  ctx: FieldCtx;
  slug: string;
  invalid: boolean;
  htmlId: string;
}) {
  const [open, setOpen] = useState(false);
  const mName = materialId ? pickedText({ lookup: 'materialVendor' } as LayoutField, materialId, ctx) || 'Selected Material' : '';
  const sName = serviceId ? pickedText({ lookup: 'serviceVendor' } as LayoutField, serviceId, ctx) || 'Selected Service' : '';
  const text = [sName, mName].filter(Boolean).join(' | ');

  return (
    <>
      <div
        id={htmlId}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        className={`w-full h-[38px] border ${invalid ? 'border-red-300' : 'border-gray-200'} rounded-[4px] px-[12px] bg-white text-[14px] text-[#22263b] flex items-center justify-between cursor-pointer hover:border-[#548df6] focus-within:border-[#548df6] transition-colors`}
        onClick={() => setOpen(true)}
        onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); } }}
      >
        <span className={text ? 'truncate' : 'text-[#9ca0ab] truncate'}>{text || 'Click to select Vendor'}</span>
        <div className="flex items-center gap-1 shrink-0">
          {text && (
            <button type="button" aria-label="Clear vendors" onClick={e => { e.stopPropagation(); onChange('', '', '', ''); }} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-red-500">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </div>
      </div>
      <VendorComboModal
        open={open}
        onClose={() => setOpen(false)}
        onSave={(sId, mId, sLabel, mLabel) => { onChange(mId, sId, mLabel, sLabel); setOpen(false); }}
        initialServiceId={serviceId}
        initialMaterialId={materialId}
        initialServiceLabel={sName}
        initialMaterialLabel={mName}
        slug={slug}
      />
    </>
  );
}

export default function RecordForm({ moduleId, mode, layout, record, refs, users, approvers, me, canApprove, canLayout, nextCode, fromProject }: Props) {
  const router = useRouter();
  const toast = useToast();
  const def = MODULES[moduleId];
  const backHref = fromProject ? `/projects/${fromProject.id}?tab=payments` : `/${def.slug}`; // Create PCR / Create PPR come from the Payments tab
  const dealLocked = (f: LayoutField) => !!fromProject && f.key === 'dealId' && f.type === 'LOOKUP';
  const kinds = useMemo(() => new Map(layout.sections.map(s => [s.id, s.kind])), [layout.sections]);
  const formFields = layout.fields.filter(f => kinds.get(f.section) === 'FORM');
  const tableSections = layout.sections.filter(s => s.kind === 'TABLE');
  const colsOf = (sectionId: string) => layout.fields.filter(f => f.section === sectionId && f.enabled);
  const start = (f: LayoutField) => initialValue(f, me, nextCode);

  const [values, setValues] = useState<FormValues>(() => {
    const v: FormValues = {};
    for (const f of formFields) v[f.key] = record ? toFormValue(f, record.values[f.key]) : dealLocked(f) ? fromProject!.dealId : start(f);
    return v;
  });
  const [rows, setRows] = useState<Record<string, RowState[]>>(() => Object.fromEntries(tableSections.map(s => {
    const cols = colsOf(s.id);
    const saved: RowState[] = (record?.rows[s.id] ?? []).map(r => ({ key: r.id, id: r.id, values: Object.fromEntries(layout.fields.filter(f => f.section === s.id).map(c => [c.key, toFormValue(c, r.values[c.key])])) }));
    return [s.id, saved.length ? saved : [newRow(cols, start, `first_${s.id}`)]];
  })));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState(0);
  const [saving, setSaving] = useState(false);

  // "Now" as a default is only worked out in the browser: the server's minute would not match the browser's
  useEffect(() => {
    if (mode !== 'create') return;
    setValues(cur => {
      const next = { ...cur };
      let changed = false;
      for (const f of formFields) {
        if (f.type === 'DATETIME' && f.enabled && f.defaultValue === '@now' && !next[f.key]) { next[f.key] = toFormValue(f, defaultFor(f, me)); changed = true; }
      }
      return changed ? next : cur;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ctx: FieldCtx = {
    slug: def.slug, users, approvers, refs, picked, canApprove,
    onPick: (id, text) => setPicked(p => ({ ...p, [id]: text })),
    onBusy: d => setUploads(n => n + d),
  };
  // A field added in Edit Page Layout while this form is open starts with its default on a new record, and empty on a saved one
  const valueOf = (f: LayoutField) => (dealLocked(f) ? fromProject!.dealId : f.key in values ? values[f.key] : mode === 'create' ? start(f) : toFormValue(f, null));
  const cellOf = (row: RowState, c: LayoutField) => row.values[c.key] ?? (row.id ? toFormValue(c, null) : start(c));
  const setValue = (key: string, v: unknown) => {
    setValues(cur => ({ ...cur, [key]: v }));
    setErrors(cur => { if (!cur[`values.${key}`]) return cur; const { [`values.${key}`]: _gone, ...rest } = cur; void _gone; return rest; });
  };

  // The fields people can type in on this form
  const editable = (f: LayoutField) => f.enabled && f.type !== 'AUTO' && !f.readOnly && !(f.type === 'APPROVER' && !canApprove);

  // A row nobody touched (still only the defaults) is not saved
  const pristine = (row: RowState, cols: LayoutField[]) => !row.id && cols.every(c => { const v = cellOf(row, c); return isBlankValue(c, v) || JSON.stringify(v) === JSON.stringify(start(c)); });

  const check = () => {
    const found: Record<string, string> = {};
    for (const f of formFields) {
      if (!editable(f)) continue;
      const pv = toPayloadValue(f, valueOf(f));
      const res = cleanValue(f, pv);
      if ('error' in res) found[`values.${f.key}`] = res.error;
      else if (f.required && f.type !== 'APPROVER' && (isBlankValue(f, valueOf(f)))) found[`values.${f.key}`] = `${f.label} is required`;
    }
    for (const s of tableSections) {
      const cols = colsOf(s.id);
      for (const row of rows[s.id] ?? []) {
        if (pristine(row, cols)) continue;
        const blank = cols.every(c => isBlankValue(c, cellOf(row, c)));
        if (blank) continue;
        for (const c of cols) {
          const v = cellOf(row, c);
          const res = cleanValue(c, toPayloadValue(c, v));
          if ('error' in res) found[`rows.${s.id}.${row.key}.${c.key}`] = res.error;
          else if (c.required && isBlankValue(c, v)) found[`rows.${s.id}.${row.key}.${c.key}`] = `${c.label} is required`;
        }
      }
    }
    return found;
  };

  const firstError = (found: Record<string, string>) => {
    const path = Object.keys(found)[0];
    if (!path) return;
    const parts = path.split('.');
    const id = parts[0] === 'values' ? `f-${parts[1]}` : `row-${parts[2]}-${parts[3]}`;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving || uploads > 0) return;
    setBanner('');
    const found = check();
    setErrors(found);
    if (Object.keys(found).length) { setBanner('Please fix the highlighted fields.'); firstError(found); return; }

    const payloadValues: Record<string, unknown> = {};
    for (const f of formFields) {
      if (!editable(f)) continue;
      payloadValues[f.key] = toPayloadValue(f, valueOf(f));
    }
    const payloadRows: Record<string, { id?: string; values: Record<string, unknown> }[]> = {};
    const sent: Record<string, string[]> = {}; // the keys of the rows in the order they were sent, to find them again if the server objects
    for (const s of tableSections) {
      const cols = colsOf(s.id);
      const kept = (rows[s.id] ?? []).filter(r => !pristine(r, cols));
      sent[s.id] = kept.map(r => r.key);
      payloadRows[s.id] = kept.map(r => ({ ...(r.id ? { id: r.id } : {}), values: Object.fromEntries(cols.map(c => [c.key, toPayloadValue(c, cellOf(r, c))])) }));
    }

    setSaving(true);
    try {
      const body = { values: payloadValues, rows: payloadRows };
      const res = mode === 'create'
        ? await callApi<{ code: string }>(fromProject ? `/api/projects/${fromProject.id}/records/${def.slug}` : api(def.slug), 'POST', body)
        : await callApi<{ code: string }>(api(def.slug, `/${record!.id}`), 'PUT', body);
      toast.success(mode === 'create' ? `${res.code} created` : `${res.code} saved`);
      router.push(backHref); // inside a project: back to the project, which now shows the new record
      router.refresh();
    } catch (err) {
      const mapped: Record<string, string> = {};
      if (err instanceof ApiError && err.details?.length) {
        for (const d of err.details) {
          const p = d.path.split('.');
          if (p[0] === 'values' && p[1]) mapped[`values.${p[1]}`] = d.message;
          else if (p[0] === 'rows' && p.length >= 4) { const key = sent[p[1]]?.[Number(p[2])]; if (key) mapped[`rows.${p[1]}.${key}.${p[3]}`] = d.message; }
        }
      }
      setErrors(mapped);
      setBanner(Object.keys(mapped).length ? 'Please fix the highlighted fields.' : err instanceof Error ? err.message : 'Could not save');
      if (Object.keys(mapped).length) firstError(mapped);
      setSaving(false);
    }
  };

  const title = mode === 'create' ? `New ${def.label}${def.hasApproval ? ' Record' : ''}` : `Edit ${record!.code}`;
  const rowErrors = (sectionId: string) => Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`rows.${sectionId}.`)).map(([k, v]) => { const p = k.split('.'); return [`${p[2]}:${p[3]}`, v]; }));

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="px-4 sm:px-6 pt-6 pb-4 border-b border-gray-200 flex flex-wrap items-center gap-3">
        <Link href={backHref} aria-label={fromProject ? `Back to project ${fromProject.code}` : `Back to ${def.plural}`} className="w-9 h-9 rounded-full border border-gray-300 hover:bg-gray-100 flex items-center justify-center text-gray-700"><ArrowLeft className="w-4 h-4" /></Link>
        <div className="min-w-0">
          <h1 className="text-[22px] sm:text-[26px] font-semibold text-[#222] leading-tight">{title}</h1>
          {mode === 'edit' && <p className="text-[13px] text-gray-500">{def.label}</p>}
          {fromProject && <p className="text-[13px] text-gray-500">For project {fromProject.code} · the deal is the project&apos;s and cannot be changed here</p>}
        </div>
        {canLayout && <div className="ml-auto"><LayoutButton moduleId={moduleId} layout={layout} variant="text" /></div>}
      </div>

      <form onSubmit={submit} noValidate className="flex-1 flex flex-col">
        <div className="flex-1 px-4 sm:px-6 py-6 space-y-8 max-w-[1500px] w-full mx-auto">
          {banner && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-[14px] text-[#b42318]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{banner}</span>
            </div>
          )}

          {layout.sections.map(section => {
            if (section.kind === 'TABLE') {
              const cols = colsOf(section.id);
              if (cols.length === 0) return null;
              return (
                <section key={section.id} aria-labelledby={`sec-${section.id}`}>
                  <h2 id={`sec-${section.id}`} className="text-[16px] font-bold text-[#222] mb-3">{section.label}</h2>
                  <TableSection sectionId={section.id} fields={cols} rows={rows[section.id] ?? []} onChange={update => setRows(cur => ({ ...cur, [section.id]: update(cur[section.id] ?? []) }))} errors={rowErrors(section.id)} ctx={ctx} initial={start} />
                </section>
              );
            }
            const rawFields = formFields.filter(f => f.section === section.id && f.enabled);
            // Pre-Payment shows both vendors in the one "Vendor Name" box (kept in the Material Vendor slot)
            const fields = def.id === 'prePayment' && rawFields.some(f => f.key === 'materialVendorId') ? rawFields.filter(f => f.key !== 'serviceVendorId') : rawFields;
            if (fields.length === 0) return null;
            return (
              <section key={section.id} aria-labelledby={`sec-${section.id}`}>
                <h2 id={`sec-${section.id}`} className="text-[16px] font-bold text-[#222] mb-4">{section.label}</h2>
                <TwoColumns
                  items={fields}
                  render={f => (
                    <FieldRow key={f.key} f={def.id === 'prePayment' && f.key === 'materialVendorId' ? { ...f, label: 'Vendor Name' } : f} htmlId={`f-${f.key}`} error={errors[`values.${f.key}`]}>
                      {dealLocked(f) ? (
                        <div id={`f-${f.key}`} data-locked-deal className="w-full h-[38px] border border-gray-200 rounded px-3 bg-gray-100 text-[14px] text-gray-700 flex items-center justify-between gap-2">
                          <span className="truncate">{fromProject!.dealLabel}</span><Lock className="w-4 h-4 text-gray-400 shrink-0" aria-label="Locked" />
                        </div>
                      ) : def.id === 'prePayment' && f.key === 'materialVendorId' ? (
                        <PrePaymentVendorCombo
                          materialId={typeof values.materialVendorId === 'string' ? values.materialVendorId : ''}
                          serviceId={typeof values.serviceVendorId === 'string' ? values.serviceVendorId : ''}
                          onChange={(mId, sId, mLabel, sLabel) => {
                            setValue('materialVendorId', mId);
                            setValue('serviceVendorId', sId);
                            if (mId && mLabel) ctx.onPick(mId, mLabel);
                            if (sId && sLabel) ctx.onPick(sId, sLabel);
                          }}
                          ctx={ctx}
                          slug={def.slug}
                          invalid={!!errors[`values.${f.key}`]}
                          htmlId={`f-${f.key}`}
                        />
                      ) : (
                        <FieldInput field={f} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={errors[`values.${f.key}`]} ctx={ctx} htmlId={`f-${f.key}`} />
                      )}
                    </FieldRow>
                  )}
                />
              </section>
            );
          })}
        </div>

        <div className="sticky bottom-0 z-20 bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center justify-end gap-3">
          {uploads > 0 && <span className="mr-auto text-[13px] text-gray-500 inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Uploading files…</span>}
          <Link href={backHref} className="px-5 h-[40px] rounded-md bg-gray-200 hover:bg-gray-300 text-gray-800 text-[14px] font-medium inline-flex items-center">Cancel</Link>
          <button type="submit" disabled={saving || uploads > 0} className="px-7 h-[40px] rounded-md bg-black hover:bg-[#222] text-white text-[14px] font-medium disabled:opacity-60 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}{saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
