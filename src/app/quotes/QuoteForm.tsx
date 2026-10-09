'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Calculator, LayoutTemplate, RefreshCw, Settings, X } from 'lucide-react';
import { ApiError, callApi } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import { cleanValue } from '@/lib/records/values';
import type { FileDto, LayoutField, LookupItem, ModuleLayoutDto, RecordRefs } from '@/lib/records/types';
import type { CustomerDto, QuoteAbilities, QuoteBody, QuoteDto, QuoteSettings } from '@/lib/quotes/types';
import { LayoutEditor } from '../records/layout-editor/LayoutEditor';
import { initialValue, isBlankValue, searchLookup, toFormValue, toPayloadValue, type FormValues } from '../records/client';
import QField, { QFiles, SLUG, shownFor, type QCtx } from './QField';
import LineItems from './LineItems';
import CalcPanel from './CalcPanel';
import { NumberingModal } from './modals';
import CustomerPicker from '../customers/CustomerPicker';
import { TermsPicker, TermsTemplatesModal } from './TermsTemplates';
import { matchTemplateId, termsTemplatesOf } from '@/lib/quotes/terms';
import { Button, Combo, FormRow, Spinner, inputClass } from './ui';
import { defaultTaxId, isInterState } from '@/lib/quotes/taxes';
import { blankLine, isBlankLine, calcFromDto, computeTotals, emptyCalc, lineFromDto, lineToInput, type CalcState, type LineState } from './form-state';

const EMPTY_REFS: RecordRefs = { users: {}, deals: {}, materialVendors: {}, serviceVendors: {}, lookups: {} };
const INFO: Record<string, string> = { subject: 'Let your customer know what this Quote is for', retainerInvoice: 'A retainer invoice for the advance is created when the quote is accepted' };

type Props = {
  mode: 'create' | 'edit';
  layout: ModuleLayoutDto;
  settings: QuoteSettings;
  quote?: QuoteDto;
  nextNumber: string;
  users: LookupItem[];
  me: { id: string; name: string };
  abilities: QuoteAbilities;
  today: string;
};

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export default function QuoteForm({ mode, layout, settings, quote, nextNumber, users: usersIn, me, abilities, today }: Props) {
  const router = useRouter();
  const toast = useToast();
  const kinds = useMemo(() => new Map(layout.sections.map(s => [s.id, s.kind])), [layout.sections]);
  const formFields = useMemo(() => layout.fields.filter(f => kinds.get(f.section) === 'FORM'), [layout.fields, kinds]);
  const itemColumns = useMemo(() => layout.fields.filter(f => f.section === 'items' && f.enabled), [layout.fields]);
  const fieldOf = (key: string) => layout.fields.find(f => f.key === key);
  const start = (f: LayoutField) => initialValue(f, me, nextNumber);

  const [values, setValues] = useState<FormValues>(() => {
    const v: FormValues = {};
    for (const f of formFields) v[f.key] = quote ? toFormValue(f, quote.values[f.key]) : start(f);
    if (!quote && settings.templates.defaultValidDays && 'expiryDate' in v && !v.expiryDate) v.expiryDate = addDays(typeof v.date === 'string' && v.date ? v.date : today, settings.templates.defaultValidDays);
    return v;
  });
  const [lines, setLinesState] = useState<LineState[]>(() => (quote?.lines.length ? quote.lines.map(lineFromDto) : [blankLine(defaultTaxId(settings.taxes))]));
  const [calc, setCalcState] = useState<CalcState>(() => (quote ? calcFromDto(quote.calc) : emptyCalc()));
  const [customer, setCustomer] = useState<CustomerDto | null>(quote?.customer ?? null);
  const [users, setUsers] = useState(usersIn);
  const [usersBusy, setUsersBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState(0);
  const [saving, setSaving] = useState<null | 'draft' | 'save' | 'send'>(null);
  const [preview, setPreview] = useState(nextNumber);
  const [manualNumber, setManualNumber] = useState<string | null>(null);
  const [numbering, setNumbering] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [termsSettings, setTermsSettings] = useState(settings.terms); // the Terms & Conditions templates (the dropdown above the text)
  const [termsPick, setTermsPick] = useState('');
  const [termsOpen, setTermsOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(quote?.id ?? null);
  const [lastSavedJSON, setLastSavedJSON] = useState<string>('');

  const customerId = typeof values.customerId === 'string' ? values.customerId : '';
  const dateValue = typeof values.date === 'string' ? values.date : '';

  // What the next number will be follows the quote date (a date in a new financial year starts a new series)
  const previewDay = mode === 'create' ? dateValue : '';
  const lastDay = useRef(today);
  const refreshPreview = useCallback(async (day: string) => {
    try {
      const r = await callApi<{ number: string }>(`/api/quotes/settings/numbering?date=${day}`, 'GET');
      setPreview(r.number);
    } catch { /* the number is taken when the quote is saved anyway */ }
  }, []);
  useEffect(() => {
    if (mode !== 'create' || !/^\d{4}-\d{2}-\d{2}$/.test(previewDay) || previewDay === lastDay.current) return;
    lastDay.current = previewDay;
    const t = setTimeout(() => void refreshPreview(previewDay), 250);
    return () => clearTimeout(t);
  }, [previewDay, mode, refreshPreview]);

  const setLines = useCallback((update: (cur: LineState[]) => LineState[]) => setLinesState(cur => update(cur)), []);
  const setCalc = (p: Partial<CalcState>) => { setCalcState(cur => ({ ...cur, ...p })); setErrors(cur => Object.fromEntries(Object.entries(cur).filter(([k]) => !k.startsWith('calc.')))); };
  const setValue = (key: string, v: unknown) => {
    setValues(cur => ({ ...cur, [key]: v }));
    setErrors(cur => { const k = `values.${key}`; if (!cur[k]) return cur; const { [k]: _gone, ...rest } = cur; void _gone; return rest; });
  };
  const valueOf = (f: LayoutField) => (f.key in values ? values[f.key] : mode === 'create' ? start(f) : toFormValue(f, null));

  const totals = useMemo(() => computeTotals(lines, calc, settings), [lines, calc, settings]);

  const ctx: QCtx = {
    users,
    refs: quote?.refs ?? EMPTY_REFS,
    picked,
    onPick: (id, text) => setPicked(p => ({ ...p, [id]: text })),
    onBusy: d => setUploads(n => n + d),
    lookupExtra: undefined,
    onLookup: (f, id, item) => {
      // Disabled as per user request: picking a deal shouldn't overwrite the customer details
      // const deal = f.lookup === 'deal' && id && item?.data?.customerId;
      // if (deal) {
      //   void callApi<{ items: { customer: CustomerDto }[] }>(`/api/quotes/customers?id=${encodeURIComponent(item!.data!.customerId as string)}`, 'GET')
      //     .then(r => { if (r.items[0]) applyCustomer(r.items[0].customer, true); })
      //     .catch(() => undefined);
      // }
    },
  };

  const applyCustomer = (c: CustomerDto, keepDeal = false) => {
    setCustomer(c);
    setPicked(p => ({ ...p, [c.id]: c.name }));
    setValues(cur => {
      const next: FormValues = { ...cur, customerId: c.id };
      if (cur.customerId !== c.id) { next.projectId = ''; if (!keepDeal) next.dealId = ''; }
      const addr = fieldOf('billingAddress');
      if (addr?.enabled) next.billingAddress = c.address ?? '';
      const gst = fieldOf('customerGstin');
      if (gst?.enabled) next.customerGstin = c.gstin ?? '';
      const pos = fieldOf('placeOfSupply');
      const code = c.placeOfSupply || (c.gstin ?? '').slice(0, 2);
      if (pos?.enabled && pos.options.some(o => o.id === code)) next.placeOfSupply = code;
      return next;
    });
    setErrors(cur => Object.fromEntries(Object.entries(cur).filter(([k]) => k !== 'values.customerId')));
  };

  const refreshUsers = async () => {
    setUsersBusy(true);
    try { setUsers((await callApi<{ items: LookupItem[] }>(`/api/records/${SLUG}/lookups?kind=users`, 'GET')).items); }
    catch { toast.error('Could not refresh the list of people'); }
    finally { setUsersBusy(false); }
  };

  // ---------------------------------------------------------------------------
  // Checking and saving
  // ---------------------------------------------------------------------------
  const editable = (f: LayoutField) => f.enabled && f.type !== 'AUTO' && f.type !== 'CALC' && !f.readOnly && f.type !== 'APPROVER';

  const check = () => {
    const found: Record<string, string> = {};
    for (const f of formFields) {
      if (!editable(f)) continue;
      const v = valueOf(f);
      const res = cleanValue(f, toPayloadValue(f, v));
      if ('error' in res) found[`values.${f.key}`] = res.error;
      else if (f.required && isBlankValue(f, v)) found[`values.${f.key}`] = `${f.label} is required`;
    }
    return found;
  };

  const firstError = (found: Record<string, string>) => {
    const path = Object.keys(found)[0];
    if (!path) return;
    const parts = path.split('.');
    const id = parts[0] === 'values' ? `f-${parts[1]}` : parts[0] === 'lines' ? `line-${parts[1]}-${parts[2] === 'custom' ? parts[3] : parts[2]}` : parts[0] === 'calc' ? 'calc-discount' : '';
    if (!id) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  };

  const buildBody = (intent: QuoteBody['intent']): QuoteBody => {
    const out: Record<string, unknown> = {};
    for (const f of formFields) if (editable(f)) out[f.key] = toPayloadValue(f, valueOf(f));
    if (mode === 'create' && settings.numbering.allowManual && manualNumber !== null && manualNumber.trim()) out.quoteNumber = manualNumber.trim();
    return {
      values: out,
      lines: lines.map(lineToInput),
      calc: {
        discountPercent: calc.discount.trim() === '' ? null : (calc.discount as unknown as number),
        shippingCharges: calc.shipping.trim() === '' ? null : (calc.shipping as unknown as number),
        withholding: calc.wTaxId ? { kind: calc.wKind, taxId: calc.wTaxId } : null,
        adjustmentLabel: calc.adjLabel.trim() || null,
        adjustment: calc.adjustment.trim() === '' ? null : (calc.adjustment as unknown as number),
      },
      intent,
    };
  };

  useEffect(() => {
    const hasMeaningfulData = customerId || lines.some(l => !isBlankLine(l)) || (typeof values.subject === 'string' && values.subject.trim());
    if (!hasMeaningfulData || saving || uploads > 0) return;

    const body = buildBody('draft');
    const bodyStr = JSON.stringify(body);
    if (bodyStr === lastSavedJSON) return;
    if (!lastSavedJSON) {
      setLastSavedJSON(bodyStr);
      return;
    }

    const t = setTimeout(async () => {
      try {
        if (draftId) {
          await callApi(`/api/quotes/${draftId}`, 'PUT', body);
          setLastSavedJSON(bodyStr);
        } else {
          const res = await callApi<{ id: string; quoteNumber: string; status: string }>('/api/quotes', 'POST', body);
          setDraftId(res.id);
          setLastSavedJSON(bodyStr);
          window.history.replaceState(null, '', `/quotes/${res.id}/edit`);
        }
      } catch (err) {
        // silently fail autosave errors
      }
    }, 1500);

    return () => clearTimeout(t);
  }, [values, lines, calc, customerId, draftId, lastSavedJSON, saving, uploads]);

  const submit = async (intent: QuoteBody['intent']) => {
    if (saving || uploads > 0) return;
    setBanner('');
    const found = check();
    if (intent === 'send' && lines.every(l => !l.name.trim())) found.lines = 'Add at least one item before sending the quote';
    setErrors(found);
    if (Object.keys(found).length) { setBanner(found.lines && Object.keys(found).length === 1 ? found.lines : 'Please fix the highlighted fields.'); firstError(found); return; }

    setSaving(intent === 'draft' ? 'draft' : intent === 'send' ? 'send' : 'save');
    try {
      const body = buildBody(intent);
      const res = !draftId
        ? await callApi<{ id: string; quoteNumber: string; status: string }>('/api/quotes', 'POST', body)
        : await callApi<{ id: string; quoteNumber: string; status: string }>(`/api/quotes/${draftId}`, 'PUT', body);
      toast.success(mode === 'create' ? `${res.quoteNumber} created` : `${res.quoteNumber} saved`);
      router.push(`/quotes/${res.id}${intent === 'send' ? '?send=1' : ''}`);
      router.refresh();
    } catch (err) {
      const mapped: Record<string, string> = {};
      if (err instanceof ApiError && err.details?.length) {
        for (const d of err.details) {
          const p = d.path.split('.');
          if (p[0] === 'values' && p[1]) mapped[`values.${p[1]}`] = d.message;
          else if (p[0] === 'lines' && p[1] !== undefined) mapped[p.length === 2 ? `lines.${p[1]}` : p[2] === 'custom' ? `lines.${p[1]}.custom.${p[3]}` : `lines.${p[1]}.${p[2]}`] = d.message;
          else if (p[0] === 'lines') mapped.lines = d.message;
          else if (p[0] === 'calc' && p[1]) mapped[`calc.${p[1]}`] = d.message;
        }
      }
      setErrors(mapped);
      setBanner(Object.keys(mapped).length ? (mapped.lines && Object.keys(mapped).length === 1 ? mapped.lines : 'Please fix the highlighted fields.') : err instanceof Error ? err.message : 'Could not save');
      if (Object.keys(mapped).length) firstError(mapped);
      setSaving(null);
    }
  };

  // ---------------------------------------------------------------------------
  // The controls of the system fields
  // ---------------------------------------------------------------------------
  const numberBox = (f: LayoutField, id: string) => {
    const manual = mode === 'create' && settings.numbering.allowManual;
    return (
      <div className="relative w-[329px] max-w-full">
        {manual ? (
          <input id={id} value={manualNumber ?? ''} onChange={e => setManualNumber(e.target.value)} placeholder={preview} maxLength={60} className={inputClass(!!errors[`values.${f.key}`], 'pr-7')} />
        ) : (
          <div id={id} data-quote-number className="w-full h-[34px] border border-[#d7d5e1] rounded-[4px] px-2 pr-7 bg-white text-[13px] flex items-center truncate">{mode === 'create' ? preview : quote?.quoteNumber}</div>
        )}
        <button type="button" onClick={() => setNumbering(true)} aria-label="Configure quote number preferences" title="Configure quote number preferences" className="absolute right-0 top-0 h-[34px] w-7 flex items-center justify-center text-[#548df6] hover:bg-[#f1f1fa] rounded-r-[4px]"><Settings className="w-3.5 h-3.5" /></button>
      </div>
    );
  };

  const customerBox = (f: LayoutField, id: string) => (
    <CustomerPicker
      htmlId={id}
      label={f.label}
      customerId={customerId}
      shown={customerId ? (picked[customerId] || customer?.name || quote?.refs.lookups?.customer?.[customerId] || '') : ''}
      invalid={!!errors[`values.${f.key}`]}
      canCreate
      canEdit
      onPick={c => applyCustomer(c)}
      onClear={() => { setValue('customerId', ''); setCustomer(null); }}
    />
  );

  const projectBox = (f: LayoutField, id: string) => (
    <div className="w-[329px] max-w-full">
      <Combo
        htmlId={id}
        value={typeof values.projectId === 'string' && values.projectId ? values.projectId : null}
        shown={typeof values.projectId === 'string' && values.projectId ? shownFor(f, values.projectId, ctx) : ''}
        search={q => searchLookup(SLUG, 'projects', q, { customerId })}
        disabled={!customerId}
        clearable
        placeholder="Select a project"
        ariaLabel={f.label}
        invalid={!!errors[`values.${f.key}`]}
        emptyText="This customer has no projects"
        onChange={(pid, item) => { if (pid && item) setPicked(p => ({ ...p, [pid]: item.label })); setValue('projectId', pid ?? ''); }}
      />
    </div>
  );

  const controlFor = (f: LayoutField, id: string): ReactNode => {
    const err = errors[`values.${f.key}`];
    if (f.key === 'quoteNumber') return numberBox(f, id);
    if (f.key === 'customerId') return customerBox(f, id);
    if (f.key === 'projectId') return projectBox(f, id);
    if (f.key === 'salespersonId') {
      return (
        <div className="flex items-center gap-3">
          <div className="w-[329px] max-w-full"><QField f={f} id={id} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={err} ctx={ctx} /></div>
          <button type="button" onClick={refreshUsers} aria-label="Refresh the list of people" title="Refresh the list" className="text-[#548df6] hover:text-[#355bd4]">{usersBusy ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" />}</button>
        </div>
      );
    }
    if (f.type === 'TEXTAREA' || f.type === 'FILE') return <div className={f.type === 'FILE' ? '' : 'w-[329px] max-w-full'}><QField f={f} id={id} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={err} ctx={ctx} /></div>;
    return <div className="w-[329px] max-w-full"><QField f={f} id={id} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={err} ctx={ctx} /></div>;
  };

  const rowFor = (f: LayoutField) => {
    const id = `f-${f.key}`;
    const hint = f.key === 'projectId' && !customerId ? 'Select a customer to associate a project.' : undefined;
    return <FormRow key={f.key} label={f.label} required={f.required} error={errors[`values.${f.key}`]} id={id} info={INFO[f.key]} hint={hint}>{controlFor(f, id)}</FormRow>;
  };

  // The rows of one section; the quote date and the expiry date that follows it share a row
  const rowsOf = (fields: LayoutField[]) => {
    const nodes: ReactNode[] = [];
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const nx = fields[i + 1];
      if (f.key === 'date' && nx?.key === 'expiryDate') {
        const id2 = `f-${nx.key}`;
        nodes.push(
          <div key={f.key} className="flex flex-wrap items-start gap-x-[28px] gap-y-[14px]">
            {rowFor(f)}
            <FormRow label={nx.label} required={nx.required} error={errors[`values.${nx.key}`]} id={id2}><div className="w-[329px] max-w-full"><QField f={nx} id={id2} value={valueOf(nx)} onChange={v => setValue(nx.key, v)} error={errors[`values.${nx.key}`]} ctx={ctx} /></div></FormRow>
          </div>,
        );
        i++;
        continue;
      }
      nodes.push(rowFor(f));
    }
    return nodes;
  };

  // ---------------------------------------------------------------------------
  // The sections, in the order of the layout
  // ---------------------------------------------------------------------------
  const fieldsIn = (sectionId: string) => formFields.filter(f => f.section === sectionId && f.enabled);

  const calcPanel = (
    <CalcPanel
      calc={calc}
      setCalc={setCalc}
      totals={totals}
      settings={settings}
      errors={errors}
      labels={Object.fromEntries(layout.fields.filter(f => f.section === 'calc').map(f => [f.key, f.label]))}
      shown={Object.fromEntries(layout.fields.filter(f => f.section === 'calc').map(f => [f.key, f.enabled]))}
    />
  );

  const notesBlock = (section: { id: string; label: string }) => {
    const fields = fieldsIn(section.id);
    if (!fields.length) return null;
    return (
      <div className="space-y-4" data-section={section.id}>
        {fields.map(f => {
          const id = `f-${f.key}`;
          return (
            <div key={f.key}>
              <label htmlFor={id} className="block text-[13px] mb-[6px]">{f.label}{f.required && <span className="text-[#d93b3b]"> *</span>}</label>
              <div className="max-w-[729px]"><QField f={f} id={id} rows={2} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={errors[`values.${f.key}`]} ctx={ctx} /></div>
              {errors[`values.${f.key}`] && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{errors[`values.${f.key}`]}</p>}
            </div>
          );
        })}
      </div>
    );
  };

  // Terms & Conditions templates: choosing one fills the text, which can still be changed for this quote
  const termsStandard = fieldOf('terms')?.defaultValue;
  const termsList = termsTemplatesOf(termsSettings, typeof termsStandard === 'string' ? termsStandard : '');
  const termsText = typeof values.terms === 'string' ? values.terms : '';
  const termsPicked = termsList.some(t => t.id === termsPick) ? termsPick : matchTemplateId(termsList, termsText);

  const termsBlock = (section: { id: string; label: string }) => {
    const fields = fieldsIn(section.id);
    if (!fields.length) return null;
    const texts = fields.filter(f => f.type === 'TEXTAREA' || f.type === 'TEXT');
    const files = fields.filter(f => f.type === 'FILE');
    const rest = fields.filter(f => !texts.includes(f) && !files.includes(f));
    const errOf = (f: LayoutField) => errors[`values.${f.key}`];
    return (
      <div className="bg-[#f9f9fb] border-y border-[#eeeeee] mt-[30px] px-[20px] py-[28px]" data-section={section.id}>
        <div className="max-w-[1506px] grid grid-cols-1 lg:grid-cols-[minmax(0,686px)_minmax(0,1fr)] gap-x-[30px] gap-y-6">
          <div className="space-y-4">
            {texts.map(f => (
              <div key={f.key}>
                <label htmlFor={`f-${f.key}`} className="block text-[13px] mb-[6px] text-[#22263b]">{f.label}{f.required && <span className="text-[#d93b3b]"> *</span>}</label>
                {f.key === 'terms' && <TermsPicker templates={termsList} pickedId={termsPicked} text={termsText} onPick={t => { setTermsPick(t.id); setValue('terms', t.content); }} onSettings={() => setTermsOpen(true)} />}
                <div className="max-w-[686px]"><QField f={f} id={`f-${f.key}`} rows={4} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={errOf(f)} ctx={ctx} /></div>
                {errOf(f) && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{errOf(f)}</p>}
              </div>
            ))}
          </div>
          <div className="space-y-4 lg:border-l lg:border-[#eeeeee] lg:pl-[17px]">
            {files.map(f => (
              <div key={f.key}>
                <div className="text-[13px] mb-[6px]">{f.label}</div>
                <QFiles fieldKey={f.key} label={f.label} files={(valueOf(f) as FileDto[]) ?? []} maxFiles={f.maxFiles} onChange={v => setValue(f.key, v)} onBusy={ctx.onBusy} />
                {errOf(f) && <p role="alert" className="mt-1 text-[12px] text-[#d9232b]">{errOf(f)}</p>}
              </div>
            ))}
          </div>
        </div>
        {rest.length > 0 && (
          <div className="mt-[25px] pt-[20px] border-t border-[#e0e0e1] max-w-[1047px] space-y-3">
            {rest.map(f => f.type === 'CHECKBOX' ? (
              <div key={f.key} className="flex items-center gap-1.5">
                <QField f={f} id={`f-${f.key}`} value={valueOf(f)} onChange={v => setValue(f.key, v)} error={errOf(f)} ctx={ctx} inlineLabel />
                {INFO[f.key] && <span title={INFO[f.key]} className="inline-flex w-3.5 h-3.5 rounded-full border border-[#7f8497] text-[#7f8497] text-[9px] font-bold items-center justify-center cursor-help">i</span>}
              </div>
            ) : rowFor(f))}
          </div>
        )}
      </div>
    );
  };

  const nodes: ReactNode[] = [];
  const used = new Set<string>();
  layout.sections.forEach((section, idx) => {
    if (used.has(section.id)) return;
    if (section.kind === 'FIXED') {
      if (section.id === 'calc') nodes.push(<div key={section.id} className="ml-[20px] mr-[20px] lg:mr-[125px] mt-[20px] flex justify-end"><div className="w-full lg:w-[520px]">{calcPanel}</div></div>);
      return;
    }
    if (section.kind === 'TABLE') {
      if (itemColumns.length === 0) return;
      // the calculation panel and the notes that come right after the table sit beside / under its Add buttons
      let right: ReactNode = null;
      let left: ReactNode = null;
      for (const s of [layout.sections[idx + 1], layout.sections[idx + 2]]) {
        if (!s) break;
        if (s.id === 'calc' && !used.has('calc')) { right = calcPanel; used.add('calc'); }
        else if (s.id === 'notes' && !used.has('notes') && kinds.get('notes') === 'FORM') { left = notesBlock(s); used.add('notes'); }
        else break;
      }
      nodes.push(
        <div key={section.id} className="mt-[40px]">
          <LineItems title={section.label} lines={lines} setLines={setLines} columns={itemColumns} settings={settings} amounts={totals.lines.map(l => l.amount)} errors={errors} ctx={ctx} canAddItem={abilities.create} canEditItem={abilities.edit} interState={isInterState(values.placeOfSupply, settings.company.stateCode)} aside={right} below={left} />
        </div>,
      );
      return;
    }
    // FORM sections
    const fields = fieldsIn(section.id);
    if (fields.length === 0) return;
    if (section.id === 'notes') { nodes.push(<div key={section.id} className="ml-[20px] mr-[20px] lg:mr-[125px] mt-[30px]">{notesBlock(section)}</div>); return; }
    if (section.id === 'terms') { nodes.push(<div key={section.id}>{termsBlock(section)}</div>); return; }
    if (section.id === 'customer') {
      nodes.push(
        <div key={section.id} className="bg-[#f9f9fb] px-[20px] pt-[29px] pb-[22px] max-w-[1548px] space-y-[14px]" data-section={section.id}>{rowsOf(fields)}</div>,
      );
      return;
    }
    const nextKind = layout.sections.slice(idx + 1).find(s => s.kind !== 'FIXED' || s.id === 'calc')?.kind;
    const toTable = nextKind === 'TABLE';
    nodes.push(
      <div key={section.id} data-section={section.id} className={`pl-[20px] ${toTable ? 'max-w-[1526px]' : 'max-w-[1067px]'}`}>
        <div className={`border-b border-[#f3f3f3] pt-[25px] ${toTable ? 'pb-[24px]' : 'pb-[30px]'}`}>
          {!section.isSystem && <h2 className="text-[13px] font-semibold text-black mb-[12px]">{section.label}</h2>}
          <div className="space-y-[14px] max-w-[1047px]">{rowsOf(fields)}</div>
        </div>
      </div>,
    );
  });

  const leave = () => router.push(mode === 'edit' && quote ? `/quotes/${quote.id}` : '/quotes');
  const busyAny = saving !== null || uploads > 0;
  const status = quote?.status;

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div className="h-[59px] px-[20px] flex items-center gap-[8px] border-b border-[#eeeeee] shrink-0">
        <span className="w-[24px] h-[24px] rounded-[6px] border-[1.5px] border-[#22263b] flex items-center justify-center" aria-hidden><Calculator className="w-4 h-4" /></span>
        <h1 className="text-[22px] font-medium text-black">{mode === 'create' ? 'New Quote' : `Edit Quote${quote ? ` · ${quote.quoteNumber}` : ''}`}</h1>
        <div className="ml-auto flex items-center gap-3">
          {abilities.layout && <button type="button" onClick={() => setLayoutOpen(true)} className="inline-flex items-center gap-1.5 h-[32px] px-2.5 rounded-[4px] border border-[#d7d5e1] text-[13px] hover:bg-[#f1f1fa]"><LayoutTemplate className="w-3.5 h-3.5" /> Edit Page Layout</button>}
          <button type="button" onClick={leave} aria-label="Close" className="text-[#e5484d] hover:bg-[#fdeeee] rounded p-1"><X className="w-5 h-5" /></button>
        </div>
      </div>

      <form
        onSubmit={e => { e.preventDefault(); void submit(mode === 'create' ? 'draft' : 'save'); }}
        // Enter in a one-line box (the item name, the reference ...) must not save a long form by accident
        onKeyDown={e => { const t = e.target as HTMLElement; if (e.key === 'Enter' && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'submit') e.preventDefault(); }}
        noValidate
        className="flex-1 flex flex-col"
      >
        <div className="flex-1 pb-[40px]">
          {banner && (
            <div role="alert" className="mx-[20px] mt-3 flex items-start gap-2 rounded-[4px] border border-[#f3c2c4] bg-[#fdeeee] px-3 py-2 text-[13px] text-[#b42318]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{banner}</span>
            </div>
          )}
          {nodes}
          <p className="px-[20px] mt-[35px] text-[13px] text-[#6d7189]"><b className="font-semibold">Additional Fields:</b> Start adding custom fields for your quotes with <i>Edit Page Layout</i>{abilities.layout ? '.' : ' (a Super Admin can do this).'}</p>
        </div>

        <div className="sticky bottom-0 z-20 bg-white border-t border-[#eeeeee] shadow-[0_-2px_6px_rgba(34,38,59,0.05)] px-[20px] py-[13px] flex flex-wrap items-center gap-[10px]">
          {mode === 'create' ? (
            <>
              <Button type="submit" busy={saving === 'draft'} disabled={busyAny} >Save as Draft</Button>
              <Button kind="blue" onClick={() => submit('send')} busy={saving === 'send'} disabled={busyAny}>Save and Send</Button>
            </>
          ) : (
            <>
              <Button type="submit" kind={status === 'Draft' ? 'grey' : 'blue'} busy={saving === 'save'} disabled={busyAny}>Save</Button>
              {status === 'Draft' && <Button kind="blue" onClick={() => submit('send')} busy={saving === 'send'} disabled={busyAny}>Save and Send</Button>}
            </>
          )}
          <Button onClick={leave} disabled={saving !== null}>Cancel</Button>
          {uploads > 0 && <span className="text-[13px] text-[#6d7189] inline-flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> Uploading files…</span>}
        </div>
      </form>

      {layoutOpen && <LayoutEditor moduleId="quote" initial={layout} onClose={changed => { setLayoutOpen(false); if (changed) router.refresh(); }} />}
      {termsOpen && (
        <TermsTemplatesModal templates={termsList} canEdit={abilities.settings} activeId={termsPicked} onClose={() => setTermsOpen(false)} onSaved={t => { setTermsSettings(t); setTermsOpen(false); }} />
      )}
      {numbering && (
        <NumberingModal
          settings={settings}
          canEdit={abilities.settings}
          day={mode === 'create' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : today}
          onClose={() => setNumbering(false)}
          onSaved={() => { setNumbering(false); void refreshPreview(mode === 'create' && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : today); router.refresh(); }}
        />
      )}
    </div>
  );
}

