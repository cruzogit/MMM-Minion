'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { CONVENTIONAL_RATES, MAX_ATTACHMENTS_PER_LEAD, type LeadFormOptions } from '@/lib/leads/constants';
import { isHttpUrl, isRealDay, normalizePhone, todayDay } from '@/lib/leads/format';
import type { LeadRow } from '@/lib/leads/queries';
import type { DealRow } from '@/lib/deals/queries';
import { ApiError, callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import FileUpload, { type ExistingFile } from './FileUpload';
import { putQueued, toUploadFile, useFileQueue, type SignedUpload, type SkippedFile } from './useFileQueue';
import type { LeadFieldDto } from '@/lib/leads/layout-shared';

// requirementId and sourceId are no longer on the form. They stay in these values only so that editing an older lead
// saves back what it already has instead of blanking it.
type Values = {
  customerName: string; contactNumber: string; taskAssignedPersonId: string; productOrServiceId: string;
  requirementId: string; exactRequirement: string; modeOfCustomerId: string; sourceId: string;
  location: string; exactLocation: string; locationLink: string;
  mainCategoryId: string; subcategoryId: string;
  leadPersonId: string; leadStatusId: string; amount: string; conventionalRate: string;
  notes: string; leadTypeId: string; dailyTask: boolean;
  dealName: string; closingDate: string; dealValue: string; dealStatusId: string; // Edit Deal only
};
type Errors = Partial<Record<keyof Values, string>>;

// Which fields are required, their labels and defaults come from Edit Page Layout (options.fields)
type CustomValues = Record<string, string | boolean>;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const input = 'w-full border-2 rounded-md px-3 h-[42px] text-[14px] text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:border-[#f5b800] disabled:bg-gray-100';
const area = 'w-full border-2 rounded-md px-3 py-2 text-[14px] text-gray-900 bg-white placeholder-gray-400 focus:outline-none focus:border-[#f5b800] resize-y';
const ok = 'border-gray-200';
const bad = 'border-[#d9232b]';

function withDefaults(base: Values, fields: LeadFieldDto[]): Values {
  const out: Values = { ...base };
  for (const f of fields) {
    if (!f.isSystem || !f.defaultable || f.defaultValue === null || !(f.key in out)) continue;
    if (f.key === 'dailyTask') out.dailyTask = f.defaultValue === 'true';
    else (out as Record<string, string | boolean>)[f.key] = f.defaultValue;
  }
  return out;
}

function initialCustom(lead: LeadRow | null, fields: LeadFieldDto[]): CustomValues {
  const out: CustomValues = {};
  for (const f of fields) {
    if (f.isSystem) continue;
    const stored = lead?.customFields?.[f.key];
    if (f.type === 'CHECKBOX') out[f.key] = lead ? stored === true : f.defaultValue === 'true';
    else out[f.key] = lead ? (stored === undefined || stored === null ? '' : String(stored)) : (f.defaultValue ?? '');
  }
  return out;
}

function initialValues(lead: LeadRow | null, options: LeadFormOptions, employeeId: string | null): Values {
  const deal = (lead as Partial<DealRow> | null)?.deal; // set when the row is a deal (Edit Deal)
  const me = employeeId && options.employees.some(e => e.id === employeeId) ? employeeId : '';
  const standard = options.leadTypes.find(t => t.label.toLowerCase() === 'standard')?.id ?? options.leadTypes[0]?.id ?? '';
  if (!lead) {
    return withDefaults({ customerName: '', contactNumber: '', taskAssignedPersonId: me, productOrServiceId: '', requirementId: '', exactRequirement: '', modeOfCustomerId: '', sourceId: '', location: '', exactLocation: '', locationLink: '', mainCategoryId: '', subcategoryId: '', leadPersonId: me, leadStatusId: '', amount: '', conventionalRate: '0', notes: '', leadTypeId: standard, dailyTask: false, dealName: '', closingDate: '', dealValue: '', dealStatusId: '' }, options.fields);
  }
  return {
    customerName: lead.customerName === '—' ? '' : lead.customerName, contactNumber: lead.contactNumber, taskAssignedPersonId: lead.ids.taskAssignedPersonId ?? '',
    productOrServiceId: lead.ids.productOrServiceId ?? '', requirementId: lead.ids.requirementId ?? '', exactRequirement: lead.exactRequirement ?? '',
    modeOfCustomerId: lead.ids.modeOfCustomerId ?? '', sourceId: lead.ids.sourceId ?? '', location: lead.location ?? '', exactLocation: lead.exactLocation ?? '',
    locationLink: lead.locationLink ?? '', mainCategoryId: lead.ids.mainCategoryId ?? '', subcategoryId: lead.ids.subcategoryId ?? '',
    leadPersonId: lead.ids.leadPersonId ?? '', leadStatusId: lead.ids.leadStatusId ?? '', amount: lead.amount !== null ? String(lead.amount) : '',
    conventionalRate: String(lead.conventionalRate ?? 0), notes: lead.notes ?? '', leadTypeId: lead.ids.leadTypeId ?? standard, dailyTask: lead.dailyTask,
    dealName: deal?.name ?? '', closingDate: deal?.closingDate ?? '', dealValue: deal ? String(deal.value) : '', dealStatusId: deal?.status?.id ?? '',
  };
}

function Field({ label, required, error, children, className = '', order }: { label: string; required?: boolean; error?: string; children: React.ReactNode; className?: string; order?: number }) {
  return (
    <div className={className} style={order === undefined ? undefined : { order }}>
      <label className="block text-[15px] font-medium text-[#6b6b6b] mb-1.5">{label}{required && ' *'}</label>
      {children}
      {error && <p role="alert" className="text-[12px] text-[#d9232b] mt-1">{error}</p>}
    </div>
  );
}

// One custom field (added in Edit Page Layout)
function CustomField({ field, value, error, options, onChange, order }: {
  order?: number; field: LeadFieldDto; value: string | boolean; error?: string; options: { id: string; label: string }[]; onChange: (v: string | boolean) => void;
}) {
  const cls = `${input} ${error ? bad : ok}`;
  const common = { 'aria-invalid': error ? true : undefined, 'aria-label': field.label } as const;
  const text = typeof value === 'string' ? value : '';
  if (field.type === 'CHECKBOX') {
    return (
      <div className="sm:col-span-2" style={{ order }}>
        <label className="flex items-center gap-2.5 text-[16px] text-[#555] cursor-pointer select-none">
          <input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} className="w-[18px] h-[18px] accent-black" />
          {field.label}{field.required && ' *'}
        </label>
        {error && <p role="alert" className="text-[12px] text-[#d9232b] mt-1">{error}</p>}
      </div>
    );
  }
  return (
    <Field order={order} label={field.label} required={field.required} error={error} className={field.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}>
      {field.type === 'TEXTAREA' ? (
        <textarea className={`${area} ${error ? bad : ok}`} rows={3} value={text} onChange={e => onChange(e.target.value)} maxLength={5000} {...common} />
      ) : field.type === 'DROPDOWN' ? (
        <select className={cls} value={text} onChange={e => onChange(e.target.value)} {...common}>
          <option value="">Select {field.label}</option>
          {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      ) : (
        <input className={cls} value={text} onChange={e => onChange(e.target.value)} maxLength={500} {...common}
          type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'EMAIL' ? 'email' : 'text'}
          step={field.type === 'NUMBER' ? 'any' : undefined}
          inputMode={field.type === 'PHONE' ? 'tel' : field.type === 'URL' ? 'url' : field.type === 'NUMBER' ? 'decimal' : undefined} />
      )}
    </Field>
  );
}

// deal: Edit Deal. The same form for the lead behind a deal (`lead` is then the deal's row), with the deal's own Deal Name, Closing Date,
// Deal Value and Deal Status in place of the Lead Status and Amount. It talks to /api/deals instead of /api/leads.
export default function AddLeadModal({ mode, lead, options: initialOptions, currentEmployeeId, storageReady, onClose, onSaved, deal = false }: {
  mode: 'create' | 'edit';
  lead: LeadRow | null;
  deal?: boolean;
  options: LeadFormOptions;
  currentEmployeeId: string | null;
  storageReady: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const base = deal ? '/api/deals' : '/api/leads';
  const [options, setOptions] = useState(initialOptions);
  const start = useMemo(() => initialValues(lead, initialOptions, currentEmployeeId), [lead, initialOptions, currentEmployeeId]);
  const [v, setV] = useState<Values>(start);
  const startCustom = useMemo(() => initialCustom(lead, initialOptions.fields), [lead, initialOptions]);
  const [custom, setCustom] = useState<CustomValues>(startCustom);
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [existing, setExisting] = useState<ExistingFile[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  // Picked files: photos are resized and compressed here, in the browser, before anything is uploaded
  const room = MAX_ATTACHMENTS_PER_LEAD - existing.filter(e => !removed.includes(e.id)).length;
  const queue = useFileQueue({ max: room, onProblem: m => toast.error(m) });
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmPhoneWarning, setConfirmPhoneWarning] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  const fieldMap = useMemo(() => new Map(options.fields.map(f => [f.key, f])), [options.fields]);
  const L = (key: string, fallback: string) => fieldMap.get(key)?.label ?? fallback;
  const R = (key: string) => !!fieldMap.get(key)?.required;
  // The form follows the order set in Edit Page Layout
  const ord = (key: string) => { const i = options.fields.findIndex(f => f.key === key); return i < 0 ? 9999 : i; };
  const customFields = useMemo(() => options.fields.filter(f => !f.isSystem), [options.fields]);

  const set = <K extends keyof Values>(k: K, value: Values[K]) => {
    setV(cur => ({ ...cur, [k]: value }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const handleRequirementChange = (req: string) => {
    set('exactRequirement', req);
    if (!req || req.trim().length < 3) return;
    
    const lowerReq = req.toLowerCase().trim();
    // Find the first subcategory where either the subcategory name contains the typed text,
    // or the typed text contains the subcategory name.
    const match = options.subcategories.find(sub => {
      const subLabel = sub.label.toLowerCase();
      return subLabel.includes(lowerReq) || lowerReq.includes(subLabel);
    });

    if (match) {
      setV(cur => {
        if (cur.mainCategoryId === match.parentId && cur.subcategoryId === match.id) return cur;
        return { ...cur, mainCategoryId: match.parentId ?? '', subcategoryId: match.id };
      });
      setErrors(x => ({ ...x, mainCategoryId: undefined, subcategoryId: undefined }));
    }
  };

  // Edit: load the files that are already attached
  useEffect(() => {
    if (mode !== 'edit' || !lead) return;
    let live = true;
    callApi<{ attachments: ExistingFile[] }>(`${base}/${lead.id}`, 'GET').then(d => live && setExisting(d.attachments)).catch(() => {});
    return () => { live = false; };
  }, [mode, lead, base]);

  const dirty = JSON.stringify(v) !== JSON.stringify(start) || JSON.stringify(custom) !== JSON.stringify(startCustom) || queue.items.length > 0 || removed.length > 0;
  const tryClose = () => { if (saving) return; if (dirty) setConfirmDiscard(true); else onClose(); };

  // Esc closes; Ctrl/Cmd+V pastes images
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !confirmDiscard) tryClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const onPaste = (e: React.ClipboardEvent) => {
    const imgs = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
    if (!imgs.length) return;
    e.preventDefault();
    queue.add(imgs.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted-${Date.now()}-${i}.png`, { type: f.type })));
  };

  const subcategories = useMemo(() => options.subcategories.filter(c => c.parentId === v.mainCategoryId), [options, v.mainCategoryId]);

  const refreshOptions = async () => {
    setRefreshing(true);
    try { setOptions(await callApi<LeadFormOptions>(`${base}/options`, 'GET')); toast.success('Categories refreshed'); }
    catch { toast.error('Could not refresh categories'); }
    finally { setRefreshing(false); }
  };

  const validate = (): Errors => {
    const e: Errors = {};
    for (const f of options.fields) {
      if (!f.isSystem || !f.required || f.key === 'dailyTask' || f.key === 'conventionalRate' || !(f.key in v)) continue;
      if (deal && (f.key === 'leadStatusId' || f.key === 'amount')) continue; // a deal has a Deal Status and a Deal Value instead
      if (!String(v[f.key as keyof Values]).trim()) e[f.key as keyof Values] = `${f.label} is required`;
    }
    if (!e.contactNumber && !normalizePhone(v.contactNumber)) e.contactNumber = 'Enter a valid contact number (7–15 digits)';
    if (!e.customerName && v.customerName.trim().length < 2) e.customerName = `${L('customerName', 'Customer Name')} is required`;
    if (v.locationLink.trim() && !isHttpUrl(v.locationLink.trim())) e.locationLink = 'Enter a valid http(s) link';
    if (!deal && v.amount.trim() && (!Number.isFinite(Number(v.amount)) || Number(v.amount) < 0)) e.amount = `${L('amount', 'Amount')} must be a positive number`;
    if (deal) {
      if (!v.dealName.trim()) e.dealName = 'Deal Name is required';
      if (!v.closingDate) e.closingDate = 'Closing Date is required';
      else if (!isRealDay(v.closingDate)) e.closingDate = 'Enter a valid Closing Date';
      else if (v.closingDate !== start.closingDate && v.closingDate < todayDay()) e.closingDate = 'Closing Date cannot be in the past';
      if (!v.dealValue.trim()) e.dealValue = 'Deal Value is required';
      else if (!Number.isFinite(Number(v.dealValue)) || Number(v.dealValue) <= 0) e.dealValue = 'Deal Value must be more than 0';
    }
    return e;
  };

  const validateCustom = (): Record<string, string> => {
    const e: Record<string, string> = {};
    for (const f of customFields) {
      const val = custom[f.key];
      const text = typeof val === 'string' ? val.trim() : '';
      if (f.type === 'CHECKBOX') { if (f.required && val !== true) e[f.key] = `${f.label} is required`; continue; }
      if (!text) { if (f.required) e[f.key] = `${f.label} is required`; continue; }
      if (f.type === 'NUMBER' && !Number.isFinite(Number(text))) e[f.key] = `${f.label} must be a number`;
      else if (f.type === 'EMAIL' && !EMAIL_RE.test(text)) e[f.key] = `${f.label} must be a valid email address`;
      else if (f.type === 'URL' && !isHttpUrl(text)) e[f.key] = 'Enter a valid http(s) link';
      else if (f.type === 'PHONE' && !normalizePhone(text)) e[f.key] = 'Enter a valid phone number (7–15 digits)';
    }
    return e;
  };

  const payload = () => ({
    customerName: v.customerName.trim(), contactNumber: v.contactNumber.trim(),
    taskAssignedPersonId: v.taskAssignedPersonId || null, productOrServiceId: v.productOrServiceId || null,
    requirementId: v.requirementId || null, exactRequirement: v.exactRequirement.trim() || null,
    modeOfCustomerId: v.modeOfCustomerId || null, sourceId: v.sourceId || null,
    location: v.location.trim() || null, exactLocation: v.exactLocation.trim() || null, locationLink: v.locationLink.trim() || null,
    mainCategoryId: v.mainCategoryId || null, subcategoryId: v.subcategoryId || null,
    leadPersonId: v.leadPersonId || null, conventionalRate: Number(v.conventionalRate || 0),
    notes: v.notes.trim() || null, leadTypeId: v.leadTypeId || null, dailyTask: v.dailyTask,
    ...(deal
      ? { dealName: v.dealName.trim(), closingDate: v.closingDate, dealValue: Number(v.dealValue), dealStatusId: v.dealStatusId || null }
      : { leadStatusId: v.leadStatusId || null, amount: v.amount.trim() ? Number(v.amount) : null }),
    customFields: Object.fromEntries(customFields.map(f => {
      const val = custom[f.key];
      if (f.type === 'CHECKBOX') return [f.key, val === true];
      const text = typeof val === 'string' ? val.trim() : '';
      return [f.key, !text ? null : f.type === 'NUMBER' ? Number(text) : text];
    })),
  });

  const uploadFiles = async (leadId: string) => {
    setPhase('Uploading files…');
    const sent = queue.items.filter(i => i.status === 'ready');
    const { uploads, skipped } = await callApi<{ uploads: SignedUpload[]; skipped: SkippedFile[] }>(`${base}/${leadId}/attachments`, 'POST', { files: sent.map(toUploadFile) });
    for (const s of skipped) toast.info(`${s.name} is already attached to this ${deal ? 'deal' : 'lead'}`);
    await putQueued(sent, uploads, queue.patch);
    const { results } = await callApi<{ results: { id: string; ok: boolean; reason?: string }[] }>(`${base}/${leadId}/attachments`, 'PUT', { ids: uploads.map(u => u.id) });
    for (const u of uploads) if (results.find(r => r.id === u.id)?.ok) queue.patch(sent[u.index].key, { status: 'uploaded' });
    const failed = results.filter(r => !r.ok);
    if (failed.length) throw new Error(failed[0].reason ?? 'A file could not be verified');
  };

  const save = async (e?: React.FormEvent | null, force: boolean = false) => {
    if (e) e.preventDefault();
    setFormError('');
    const found = validate();
    const foundCustom = validateCustom();
    setErrors(found);
    setCustomErrors(foundCustom);
    if (Object.keys(found).length || Object.keys(foundCustom).length) {
      body.current?.querySelector('[aria-invalid="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    if (queue.items.length && !storageReady) { setFormError('File storage is not configured yet, so files cannot be attached. Remove the files, or ask your administrator to set it up.'); return; }
    if (queue.processing) { setFormError('Images are still being processed. Please wait a moment and save again.'); return; }
    if (queue.hasErrors) { setFormError('Some files could not be used. Remove the files marked in red, then save again.'); return; }

    if (!force && mode === 'create') {
      setSaving(true);
      setPhase('Checking contact number…');
      try {
        const res = await callApi<{exists: boolean}>(`/api/leads/check-phone?phone=${encodeURIComponent(v.contactNumber)}`, 'GET');
        if (res.exists) {
          setSaving(false);
          setPhase('');
          setConfirmPhoneWarning(true);
          return;
        }
      } catch (err) {
        // ignore check failure and proceed
      }
    }

    setSaving(true);
    setPhase(deal ? 'Saving deal…' : 'Saving lead…');
    let leadId = lead?.id ?? '';
    let code = lead?.code ?? '';
    try {
      if (mode === 'create') {
        const res = await callApi<{ lead: { id: string; code: string } }>('/api/leads', 'POST', payload());
        leadId = res.lead.id; code = res.lead.code;
      } else {
        await callApi(`${base}/${leadId}`, 'PUT', payload());
      }
    } catch (err) {
      if (err instanceof ApiError && err.details?.length) {
        const fieldErrors: Errors = {};
        const customFieldErrors: Record<string, string> = {};
        for (const d of err.details) {
          if (d.path.startsWith('customFields.')) customFieldErrors[d.path.slice('customFields.'.length)] = d.message;
          else if (d.path) fieldErrors[d.path as keyof Values] = d.message;
        }
        setErrors(fieldErrors);
        setCustomErrors(customFieldErrors);
      }
      setFormError(err instanceof Error ? err.message : deal ? 'Could not save the deal' : 'Could not save the lead');
      setSaving(false); setPhase('');
      return;
    }

    // The lead is saved. File problems from here on must not make the user save again (that would duplicate the lead).
    let warning = '';
    try {
      for (const id of removed) await callApi(`${base}/${leadId}/attachments/${id}`, 'DELETE');
      if (queue.items.length) await uploadFiles(leadId);
    } catch (err) {
      warning = err instanceof Error ? err.message : 'Some files could not be uploaded';
    }
    if (!warning && queue.items.some(i => i.status === 'uploaded')) await new Promise(resolve => setTimeout(resolve, 700)); // let the ✓ Uploaded state be seen
    setSaving(false); setPhase('');
    if (warning) toast.error(`${code} saved, but a file problem occurred: ${warning}. Open the ${deal ? 'deal' : 'lead'} and use Edit to attach the files again.`);
    onSaved(mode === 'create' ? `Lead ${code} created` : deal ? `Deal ${code} updated` : `Lead ${code} updated`);
  };

  const ring = (k: keyof Values) => (errors[k] ? bad : ok);
  const inv = (k: keyof Values) => (errors[k] ? true : undefined);

  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-4" onPaste={onPaste}>
      <div role="dialog" aria-modal="true" aria-labelledby="lead-modal-title" className="bg-white w-full sm:max-w-[820px] max-h-screen sm:max-h-[94vh] sm:rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 id="lead-modal-title" className="text-[19px] font-bold text-[#444]">{mode === 'create' ? 'Add New Lead' : `Edit ${deal ? 'Deal' : 'Lead'} ${lead?.code ?? ''}`}</h2>
          <button onClick={tryClose} aria-label="Close" className="text-gray-500 hover:text-black"><X className="w-6 h-6" /></button>
        </div>

        <form onSubmit={save} noValidate className="flex flex-col min-h-0 flex-1">
          <div ref={body} className="overflow-y-auto px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5 flex-1">
            {deal && (
              <>
                <Field order={-2} label="Deal Name" required error={errors.dealName}>
                  <input className={`${input} ${ring('dealName')}`} aria-invalid={inv('dealName')} value={v.dealName} onChange={e => set('dealName', e.target.value)} placeholder="e.g. ABC Interior Project" maxLength={200} autoFocus />
                </Field>
                <Field order={-1} label="Closing Date" required error={errors.closingDate}>
                  <input type="date" className={`${input} ${ring('closingDate')}`} aria-invalid={inv('closingDate')} value={v.closingDate} onChange={e => set('closingDate', e.target.value)} />
                </Field>
              </>
            )}
            <Field order={ord('customerName')} label={L('customerName', 'Customer Name')} required={R('customerName')} error={errors.customerName}>
              <input className={`${input} ${ring('customerName')}`} aria-invalid={inv('customerName')} value={v.customerName} onChange={e => set('customerName', e.target.value)} placeholder="Enter customer name" maxLength={120} autoFocus={!deal} />
            </Field>
            <Field order={ord('contactNumber')} label={L('contactNumber', 'Contact Number')} required={R('contactNumber')} error={errors.contactNumber}>
              <input className={`${input} ${ring('contactNumber')}`} aria-invalid={inv('contactNumber')} value={v.contactNumber} onChange={e => set('contactNumber', e.target.value)} placeholder="Enter contact number" inputMode="tel" maxLength={30} />
            </Field>

            <Field order={ord('taskAssignedPersonId')} label={L('taskAssignedPersonId', 'Task Assigned Person')} required={R('taskAssignedPersonId')} error={errors.taskAssignedPersonId}>
              <select className={`${input} ${ring('taskAssignedPersonId')}`} aria-invalid={inv('taskAssignedPersonId')} value={v.taskAssignedPersonId} onChange={e => set('taskAssignedPersonId', e.target.value)}>
                <option value="">Select Person</option>
                {options.employees.map(o => <option key={o.id} value={o.id}>{o.name}{o.designation ? ` (${o.designation})` : ''}</option>)}
              </select>
            </Field>
            <Field order={ord('productOrServiceId')} label={L('productOrServiceId', 'Product or Service')} required={R('productOrServiceId')} error={errors.productOrServiceId}>
              <select className={`${input} ${ring('productOrServiceId')}`} aria-invalid={inv('productOrServiceId')} value={v.productOrServiceId} onChange={e => set('productOrServiceId', e.target.value)}>
                <option value="">Select Type</option>
                {options.productOrService.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>

            <Field order={ord('exactRequirement')} label={L('exactRequirement', 'Requirement')} required={R('exactRequirement')} error={errors.exactRequirement}>
              <input className={`${input} ${ring('exactRequirement')}`} aria-invalid={inv('exactRequirement')} aria-label={L('exactRequirement', 'Requirement')} placeholder="Enter requirement" value={v.exactRequirement} onChange={e => handleRequirementChange(e.target.value)} maxLength={300} />
            </Field>
              <Field order={ord('modeOfCustomerId')} label={L('modeOfCustomerId', 'Mode of Customer')} required={R('modeOfCustomerId')} error={errors.modeOfCustomerId}>
                <select className={`${input} ${ring('modeOfCustomerId')}`} aria-invalid={inv('modeOfCustomerId')} value={v.modeOfCustomerId} onChange={e => set('modeOfCustomerId', e.target.value)}>
                  <option value="">Select Mode of Customer</option>
                  {options.modesOfCustomer.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </Field>

            <Field order={ord('location')} label={L('location', 'Location')} required={R('location')} error={errors.location}>
              <input className={`${input} ${ring('location')}`} aria-invalid={inv('location')} value={v.location} onChange={e => set('location', e.target.value)} placeholder="e.g. Chennai, Tamil Nadu, India" maxLength={200} />
            </Field>
            <Field order={ord('exactLocation')} label={L('exactLocation', 'Exact Location')} required={R('exactLocation')} error={errors.exactLocation}>
              <input className={`${input} ${ring('exactLocation')}`} aria-invalid={inv('exactLocation')} value={v.exactLocation} onChange={e => set('exactLocation', e.target.value)} placeholder="Enter exact location" maxLength={300} />
            </Field>

            <Field order={ord('locationLink')} label={L('locationLink', 'Location Link')} required={R('locationLink')} error={errors.locationLink}>
              <input className={`${input} ${ring('locationLink')}`} aria-invalid={inv('locationLink')} value={v.locationLink} onChange={e => set('locationLink', e.target.value)} placeholder="Enter Google Maps link or location URL" inputMode="url" maxLength={2000} />
            </Field>
            <Field order={ord('mainCategoryId')} label={L('mainCategoryId', 'Main Category')} required={R('mainCategoryId')} error={errors.mainCategoryId}>
              <div className="flex gap-2">
                <select className={`${input} ${ring('mainCategoryId')}`} aria-invalid={inv('mainCategoryId')} value={v.mainCategoryId} onChange={e => { setErrors(x => ({ ...x, mainCategoryId: undefined })); setV(c => ({ ...c, mainCategoryId: e.target.value, subcategoryId: '' })); }}>
                  <option value="">Select Main Category</option>
                  {options.mainCategories.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <button type="button" onClick={refreshOptions} title="Reload categories" aria-label="Reload categories" className="w-10 h-[42px] shrink-0 rounded-md bg-[#dc3545] hover:bg-[#c82333] text-white flex items-center justify-center">
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </Field>
            <Field order={ord('subcategoryId')} label={L('subcategoryId', 'Subcategory')} required={R('subcategoryId')} error={errors.subcategoryId}>
              <select className={`${input} ${ring('subcategoryId')}`} aria-invalid={inv('subcategoryId')} value={v.subcategoryId} onChange={e => set('subcategoryId', e.target.value)} disabled={!v.mainCategoryId}>
                <option value="">Select Subcategory</option>
                {subcategories.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>

            <Field order={ord('leadPersonId')} label={L('leadPersonId', 'Lead Person')} required={R('leadPersonId')} error={errors.leadPersonId}>
              <select className={`${input} ${ring('leadPersonId')}`} aria-invalid={inv('leadPersonId')} value={v.leadPersonId} onChange={e => set('leadPersonId', e.target.value)}>
                <option value="">Select Person</option>
                {options.employees.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            {deal ? (
              <Field order={ord('leadStatusId')} label="Deal Status" error={errors.dealStatusId}>
                <select className={`${input} ${ring('dealStatusId')}`} aria-invalid={inv('dealStatusId')} value={v.dealStatusId} onChange={e => set('dealStatusId', e.target.value)}>
                  <option value="">Select Deal Status</option>
                  {options.dealStatuses.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </Field>
            ) : (
              <Field order={ord('leadStatusId')} label={L('leadStatusId', 'Lead Status')} required={R('leadStatusId')} error={errors.leadStatusId}>
                <select className={`${input} ${ring('leadStatusId')}`} aria-invalid={inv('leadStatusId')} value={v.leadStatusId} onChange={e => set('leadStatusId', e.target.value)}>
                  <option value="">Select Lead Status</option>
                  {options.leadStatuses.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
              </Field>
            )}

            {deal ? (
              <Field order={ord('amount')} label="Deal Value" required error={errors.dealValue}>
                <input className={`${input} ${ring('dealValue')}`} aria-invalid={inv('dealValue')} type="number" min={0} step="0.01" inputMode="decimal" value={v.dealValue} onChange={e => set('dealValue', e.target.value)} placeholder="0.00" />
              </Field>
            ) : (
              <Field order={ord('amount')} label={L('amount', 'Amount')} required={R('amount')} error={errors.amount}>
                <input className={`${input} ${ring('amount')}`} aria-invalid={inv('amount')} type="number" min={0} step="0.01" inputMode="decimal" value={v.amount} onChange={e => set('amount', e.target.value)} placeholder="0.00" />
              </Field>
            )}
            <Field order={ord('conventionalRate')} label={L('conventionalRate', 'Conventional Rate')} required={R('conventionalRate')}>
              <select className={`${input} ${ok}`} value={v.conventionalRate} onChange={e => set('conventionalRate', e.target.value)}>
                {CONVENTIONAL_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
              </select>
            </Field>

            <Field order={ord('notes')} label={L('notes', 'Notes')} required={R('notes')} error={errors.notes}>
              <textarea className={`${area} ${ring('notes')}`} aria-invalid={inv('notes')} rows={4} value={v.notes} onChange={e => set('notes', e.target.value)} maxLength={5000} />
            </Field>
            <Field order={ord('leadTypeId')} label={L('leadTypeId', 'Type Of Lead')} required={R('leadTypeId')} error={errors.leadTypeId}>
              <select className={`${input} ${ring('leadTypeId')}`} aria-invalid={inv('leadTypeId')} value={v.leadTypeId} onChange={e => set('leadTypeId', e.target.value)}>
                <option value="">Select Type Of Lead</option>
                {options.leadTypes.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </Field>

            {customFields.map(f => (
              <CustomField key={f.key} order={ord(f.key)} field={f} value={custom[f.key]} error={customErrors[f.key]} options={options.customOptions[f.key] ?? []}
                onChange={val => { setCustom(c => ({ ...c, [f.key]: val })); if (customErrors[f.key]) setCustomErrors(x => ({ ...x, [f.key]: '' })); }} />
            ))}

            <Field order={ord('attachments')} label={L('attachments', 'Upload Files')} className="sm:col-span-2">
              <FileUpload items={queue.items} existing={existing} removedIds={removed} room={room - queue.items.length} disabled={saving}
                onAdd={queue.add} onRemove={queue.remove}
                onRemoveExisting={id => setRemoved(cur => [...cur, id])} onError={m => toast.error(m)} />
              {!storageReady && <p className="text-[12px] text-amber-700 mt-1">File storage is not configured yet; files cannot be attached until it is.</p>}
            </Field>

            <label style={{ order: ord('dailyTask') }} className="sm:col-span-2 flex items-center gap-2.5 text-[16px] text-[#555] cursor-pointer select-none pt-1">
              <input type="checkbox" checked={v.dailyTask} onChange={e => set('dailyTask', e.target.checked)} className="w-[18px] h-[18px] accent-black" />
              {L('dailyTask', 'Daily Task Settings')}
            </label>
          </div>

          <div className="shrink-0 border-t border-gray-200 px-6 py-4 flex flex-wrap items-center justify-end gap-3 bg-white">
            {formError && <p role="alert" className="mr-auto text-[13px] text-[#d9232b] max-w-[60%]">{formError}</p>}
            {saving && <span className="text-[13px] text-gray-500 flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />{phase}</span>}
            <button type="button" onClick={tryClose} disabled={saving} className="px-5 h-[42px] rounded-md bg-[#444] hover:bg-[#333] text-white text-[15px] font-medium disabled:opacity-60">Cancel</button>
            <button type="submit" disabled={saving} className="px-5 h-[42px] rounded-md bg-black hover:bg-[#222] text-white text-[15px] font-medium disabled:opacity-60">{deal ? 'Save Deal' : 'Save Lead'}</button>
          </div>
        </form>
      </div>

      {confirmDiscard && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="discard-title" className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm">
            <h3 id="discard-title" className="text-[17px] font-bold text-[#333]">Discard changes?</h3>
            <p className="text-[14px] text-gray-600 mt-2">You have unsaved changes. If you close now they will be lost.</p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDiscard(false)} className="px-4 h-[38px] rounded-md bg-gray-200 text-gray-800 text-[14px]">Keep editing</button>
              <button onClick={onClose} className="px-4 h-[38px] rounded-md bg-[#d9232b] text-white text-[14px]">Discard</button>
            </div>
          </div>
        </div>
      )}

      {confirmPhoneWarning && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="phone-warning-title" className="bg-white rounded-lg shadow-2xl p-6 w-full max-w-sm">
            <h3 id="phone-warning-title" className="text-[17px] font-bold text-[#333]">Contact Number Exists</h3>
            <p className="text-[14px] text-gray-600 mt-2">This contact number is already saved in an existing lead or deal. Do you still want to add this lead?</p>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setConfirmPhoneWarning(false)} className="px-4 h-[38px] rounded-md bg-gray-200 text-gray-800 text-[14px]">Cancel</button>
              <button onClick={() => { setConfirmPhoneWarning(false); save(null, true); }} className="px-4 h-[38px] rounded-md bg-black text-white text-[14px]">Okay</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
