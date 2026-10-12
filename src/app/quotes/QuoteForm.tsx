'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, AlertTriangle, Calculator, Check, Eye, LayoutTemplate, RefreshCw, Settings, X } from 'lucide-react';
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
import { applyMarkup, blankLine, calcFromDto, computeTotals, emptyCalc, lineFromDto, lineToInput, manualRateCount, mergeVendorLines, vendorLine, type CalcState, type LineState } from './form-state';
import VendorQuoteUpload, { type VendorOutcome } from './VendorQuoteUpload';
import { normName, parseProfitPercent } from '@/lib/quotes/vendor-quote';
import type { FormBoot } from '@/lib/quotes/resume';
import { changeSignature, draftSignature, hasMeaningfulData, type DraftState, type DraftUi } from '@/lib/quotes/draft';
import useDraftSync, { clearBackup } from './useDraftSync';
import QuotePreview from './QuotePreview';
import { previewQuote } from './preview-dto';

const EMPTY_REFS: RecordRefs = { users: {}, deals: {}, materialVendors: {}, serviceVendors: {}, lookups: {} };
const INFO: Record<string, string> = { subject: 'Let your customer know what this Quote is for', retainerInvoice: 'A retainer invoice for the advance is created when the quote is accepted' };

export type QuoteFormProps = {
  mode: 'create' | 'edit';
  layout: ModuleLayoutDto;
  settings: QuoteSettings;
  quote?: QuoteDto;
  nextNumber: string;
  users: LookupItem[];
  me: { id: string; name: string };
  abilities: QuoteAbilities;
  today: string;
  images: { logo: string | null; signature: string | null };
};
type Props = QuoteFormProps & { boot: FormBoot };

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// A field the person can type in (the number, calculated and approver fields are not)
const editable = (f: LayoutField) => f.enabled && f.type !== 'AUTO' && f.type !== 'CALC' && !f.readOnly && f.type !== 'APPROVER';

type Initial = { values: FormValues; lines: LineState[]; calc: CalcState; customer: CustomerDto | null; picked: Record<string, string>; profitPct: string; manualNumber: string | null; termsPick: string };

// What the form holds when it opens: the working copy when there is one, else the saved quote, else a blank form
function initialForm(a: { seed: DraftState | null; quote?: QuoteDto; formFields: LayoutField[]; start: (f: LayoutField) => unknown; settings: QuoteSettings; today: string }): Initial {
  const { seed, quote, formFields, start, settings, today } = a;
  const values: FormValues = {};
  for (const f of formFields) values[f.key] = seed && f.key in seed.values ? seed.values[f.key] : quote ? toFormValue(f, quote.values[f.key]) : start(f);
  if (!quote && !seed && settings.templates.defaultValidDays && 'expiryDate' in values && !values.expiryDate) values.expiryDate = addDays(typeof values.date === 'string' && values.date ? values.date : today, settings.templates.defaultValidDays);
  const firstRow = () => [blankLine(defaultTaxId(settings.taxes))];
  return {
    values,
    lines: seed ? (seed.lines.length ? seed.lines : firstRow()) : quote?.lines.length ? quote.lines.map(lineFromDto) : firstRow(),
    calc: seed ? seed.calc : quote ? calcFromDto(quote.calc) : emptyCalc(),
    customer: seed ? seed.customer : quote?.customer ?? null,
    picked: seed ? seed.picked : {},
    profitPct: seed ? seed.profitPct : quote?.profitPercent != null ? String(quote.profitPercent) : '', // Upload Vendor Quote: markup on the vendor rates
    manualNumber: seed ? seed.manualNumber : null,
    termsPick: seed ? seed.termsPick : '',
  };
}

const NO_UI: DraftUi = { focusId: null, selStart: null, selEnd: null, scrollY: 0 };
const stateOf = (i: Initial): DraftState => ({ v: 1, values: i.values, lines: i.lines, calc: i.calc, profitPct: i.profitPct, manualNumber: i.manualNumber, customer: i.customer, picked: i.picked, termsPick: i.termsPick, ui: NO_UI });

export default function QuoteForm({ mode, layout, settings, quote, nextNumber, users: usersIn, me, abilities, today, images, boot }: Props) {
  const router = useRouter();
  const toast = useToast();
  const kinds = useMemo(() => new Map(layout.sections.map(s => [s.id, s.kind])), [layout.sections]);
  const formFields = useMemo(() => layout.fields.filter(f => kinds.get(f.section) === 'FORM'), [layout.fields, kinds]);
  const itemColumns = useMemo(() => layout.fields.filter(f => f.section === 'items' && f.enabled), [layout.fields]);
  const fieldOf = (key: string) => layout.fields.find(f => f.key === key);
  const start = (f: LayoutField) => initialValue(f, me, nextNumber);

  const [init] = useState(() => initialForm({ seed: boot.state, quote, formFields, start, settings, today }));
  // What the saved quote says, to tell whether Cancel would lose anything
  const [originalSig] = useState(() => (mode === 'edit' ? changeSignature(stateOf(initialForm({ seed: null, quote, formFields, start, settings, today }))) : ''));

  const [values, setValues] = useState<FormValues>(init.values);
  const [lines, setLinesState] = useState<LineState[]>(init.lines);
  const [calc, setCalcState] = useState<CalcState>(init.calc);
  const [customer, setCustomer] = useState<CustomerDto | null>(init.customer);
  const [users, setUsers] = useState(usersIn);
  const [usersBusy, setUsersBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>(init.picked);
  const [uploads, setUploads] = useState(0);
  const [saving, setSaving] = useState<null | 'draft' | 'save' | 'send'>(null);
  const [preview, setPreview] = useState(nextNumber);
  const [manualNumber, setManualNumber] = useState<string | null>(init.manualNumber);
  const [numbering, setNumbering] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [termsSettings, setTermsSettings] = useState(settings.terms); // the Terms & Conditions templates (the dropdown above the text)
  const [termsPick, setTermsPick] = useState(init.termsPick);
  const [termsOpen, setTermsOpen] = useState(false);
  const [leaveAsk, setLeaveAsk] = useState(false); // "Leave this page?"
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [staleAsk, setStaleAsk] = useState<null | QuoteBody['intent']>(null); // the quote was changed by someone else: save over it?
  const [noticeOpen, setNoticeOpen] = useState(!!boot.notice);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [profitPct, setProfitPct] = useState<string>(init.profitPct); // Upload Vendor Quote: markup on the vendor rates
  const profitValue = parseProfitPercent(profitPct); // null while what is typed is not a valid percentage
  const savedProfit = useRef<number | null>(quote?.profitPercent ?? parseProfitPercent(init.profitPct)); // the last valid value: a half-typed one is never sent as the quote's

  const customerId = typeof values.customerId === 'string' ? values.customerId : '';
  const dateValue = typeof values.date === 'string' ? values.date : '';

  // ---------------------------------------------------------------------------
  // Auto-save: the form as it is, also what is half done, goes to the database a moment after every change
  // ---------------------------------------------------------------------------
  const rootRef = useRef<HTMLDivElement>(null);
  const live = useRef({ values, lines, calc, customer, picked, profitPct, manualNumber, termsPick });
  useEffect(() => { live.current = { values, lines, calc, customer, picked, profitPct, manualNumber, termsPick }; });

  const read = useCallback((): DraftState => {
    // where the cursor is and how far the page is scrolled, to put the person back there
    const el = document.activeElement;
    const inForm = el instanceof HTMLElement && !!el.id && !!rootRef.current?.contains(el);
    let selStart: number | null = null;
    let selEnd: number | null = null;
    if (inForm && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      try { selStart = el.selectionStart; selEnd = el.selectionEnd; } catch { /* a box type without a selection */ }
    }
    return { v: 1, ...live.current, ui: { focusId: inForm ? el.id : null, selStart, selEnd, scrollY: Math.max(0, Math.round(window.scrollY)) } };
  }, []);

  const sync = useDraftSync({
    mode,
    quoteId: quote?.id,
    initial: boot.draft,
    read,
    startDirty: boot.startDirty,
    onCreated: h => { if (mode === 'create') window.history.replaceState(null, '', `/quotes/new?draft=${h.id}`); }, // a refresh opens the same quote in progress
  });
  const { touch, touchUi } = sync;

  const lastSig = useRef<string | null>(null);
  useEffect(() => {
    const sig = draftSignature(read());
    if (lastSig.current === null) { lastSig.current = sig; return; } // how the form opened is not a change
    if (sig === lastSig.current) return;
    lastSig.current = sig;
    touch();
  }, [values, lines, calc, customer, picked, profitPct, manualNumber, termsPick, read, touch]);

  // The cursor and the scroll position travel with the next save and with the one made when the page is closed
  useEffect(() => {
    const mark = () => touchUi();
    document.addEventListener('selectionchange', mark);
    document.addEventListener('focusin', mark);
    window.addEventListener('scroll', mark, { passive: true });
    return () => {
      document.removeEventListener('selectionchange', mark);
      document.removeEventListener('focusin', mark);
      window.removeEventListener('scroll', mark);
    };
  }, [touchUi]);

  // After a refresh: back to the box that had the cursor, at the place it was
  useEffect(() => {
    const ui = boot.state?.ui;
    if (!ui) return;
    const t = setTimeout(() => {
      window.scrollTo(0, ui.scrollY);
      const el = ui.focusId ? document.getElementById(ui.focusId) : null;
      if (!(el instanceof HTMLElement)) return;
      el.focus({ preventScroll: true });
      if ((el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && ui.selStart !== null) {
        try { el.setSelectionRange(ui.selStart, ui.selEnd ?? ui.selStart); } catch { /* a box type without a selection */ }
      }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the form opens
  }, []);

  // This tab is on this quote: a refresh goes straight back into it, coming back later asks (see QuoteEditor)
  useEffect(() => {
    if (mode !== 'edit' || !quote) return;
    const key = `minion.quote.open:${quote.id}`;
    try { window.sessionStorage.setItem(key, '1'); } catch { /* a convenience */ }
    return () => { try { window.sessionStorage.removeItem(key); } catch { /* a convenience */ } };
  }, [mode, quote]);

  // The number: the one the quote in progress reserved, else what the next one will be
  const shownNumber = mode === 'create' ? sync.quoteNumber ?? preview : quote?.quoteNumber ?? '';

  // What the next number will be follows the quote date (a date in a new financial year starts a new series) until the quote in progress holds one
  const previewDay = mode === 'create' && !sync.quoteNumber ? dateValue : '';
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
  };

  const onProfitChange = (v: string) => {
    setProfitPct(v);
    const n = parseProfitPercent(v);
    setErrors(cur => {
      const { profitPercent: _gone, ...rest } = cur;
      void _gone;
      return n === null ? { ...rest, profitPercent: 'Enter a number from 0 to 1000 with two decimals at most' } : rest;
    });
    if (n === null) return;
    savedProfit.current = v.trim() === '' ? null : n;
    setLines(cur => applyMarkup(cur, n));
  };

  // The rows of a vendor quote, reviewed and confirmed, go into the quote (a row that is on the quote already is updated, not added again)
  const applyVendor = (o: VendorOutcome) => {
    const results = new Map(o.results.map(r => [r.key, r]));
    const interState = isInterState(values.placeOfSupply, settings.company.stateCode);
    const incoming = o.rows.map(r => {
      const id = results.get(r.key)?.itemId;
      return vendorLine(r, id ? o.items[id] ?? null : null, { defaultTax: defaultTaxId(settings.taxes), interState, profitPercent: profitValue ?? 0 });
    });
    const merged = mergeVendorLines(lines, incoming);
    setLines(() => merged.lines);
    const count = (s: string) => o.results.filter(r => r.status === s).length;
    const made = count('created');
    const changed = count('updated');
    toast.success(
      `${merged.added} row${merged.added === 1 ? '' : 's'} added${merged.updated ? `, ${merged.updated} updated` : ''} from ${o.fileName}${made ? `; ${made} new item${made === 1 ? '' : 's'} added to Items` : ''}${changed ? `; ${changed} item${changed === 1 ? '' : 's'} updated in Items` : ''}`,
    );
  };

  const applyCustomer = (c: CustomerDto) => {
    setCustomer(c);
    setPicked(p => ({ ...p, [c.id]: c.name }));
    setValues(cur => {
      const next: FormValues = { ...cur, customerId: c.id };
      if (cur.customerId !== c.id) { next.projectId = ''; }
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
  const check = () => {
    const found: Record<string, string> = {};
    if (profitValue === null) found.profitPercent = 'Enter a number from 0 to 1000 with two decimals at most';
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
    const id = parts[0] === 'values' ? `f-${parts[1]}` : parts[0] === 'lines' ? `line-${parts[1]}-${parts[2] === 'custom' ? parts[3] : parts[2]}` : parts[0] === 'calc' ? 'calc-discount' : parts[0] === 'profitPercent' ? 'f-profitPercent' : '';
    if (!id) return;
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  };

  // The fields as the API takes them (also what the preview is drawn from). A value that cannot be turned into one is left out.
  const payloadValues = useCallback((vals: FormValues): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of formFields) {
      if (!editable(f)) continue;
      try { out[f.key] = toPayloadValue(f, f.key in vals ? vals[f.key] : toFormValue(f, null)); } catch { /* half typed */ }
    }
    return out;
  }, [formFields]);

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
      profitPercent: profitValue !== null ? (profitPct.trim() === '' ? null : profitValue) : savedProfit.current,
      intent,
    };
  };

  const submit = async (intent: QuoteBody['intent'], force = false) => {
    if (saving || uploads > 0) return;
    setBanner('');
    const found = check();
    if (intent === 'send' && lines.every(l => l.isHeader || !l.name.trim())) found.lines = 'Add at least one item before sending the quote';
    setErrors(found);
    if (Object.keys(found).length) { setBanner(found.lines && Object.keys(found).length === 1 ? found.lines : 'Please fix the highlighted fields.'); firstError(found); return; }

    setSaving(intent === 'draft' ? 'draft' : intent === 'send' ? 'send' : 'save');
    try {
      // Everything typed so far is in the quote in progress first: a new quote then turns that very draft into the quote (same record, same number),
      // and a saved quote notices a change that someone else made after this editing started
      await sync.flush();
      const body: QuoteBody = { ...buildBody(intent), ...(mode === 'create' ? { draftId: sync.draftIdNow() } : force ? { force: true } : {}) };
      const res = mode === 'create' || !quote
        ? await callApi<{ id: string; quoteNumber: string; status: string }>('/api/quotes', 'POST', body)
        : await callApi<{ id: string; quoteNumber: string; status: string }>(`/api/quotes/${quote.id}`, 'PUT', body);
      sync.finish(); // saved: the quote in progress is gone from the server, nothing more to keep
      toast.success(mode === 'create' ? `${res.quoteNumber} created` : `${res.quoteNumber} saved`);
      router.push(`/quotes/${res.id}${intent === 'send' ? '?send=1' : ''}`);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.body?.code === 'STALE') { setStaleAsk(intent); setSaving(null); return; }
      const mapped: Record<string, string> = {};
      if (err instanceof ApiError && err.details?.length) {
        for (const d of err.details) {
          const p = d.path.split('.');
          if (p[0] === 'values' && p[1]) mapped[`values.${p[1]}`] = d.message;
          else if (p[0] === 'lines' && p[1] !== undefined) mapped[p.length === 2 ? `lines.${p[1]}` : p[2] === 'custom' ? `lines.${p[1]}.custom.${p[3]}` : `lines.${p[1]}.${p[2]}`] = d.message;
          else if (p[0] === 'lines') mapped.lines = d.message;
          else if (p[0] === 'calc' && p[1]) mapped[`calc.${p[1]}`] = d.message;
          else if (p[0] === 'profitPercent') mapped.profitPercent = d.message;
        }
      }
      setErrors(mapped);
      setBanner(Object.keys(mapped).length ? (mapped.lines && Object.keys(mapped).length === 1 ? mapped.lines : 'Please fix the highlighted fields.') : err instanceof Error ? err.message : 'Could not save');
      if (Object.keys(mapped).length) firstError(mapped);
      setSaving(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Leaving. Closing the tab, refreshing or following a link never discards anything: the quote in progress stays and comes back. Only Cancel / X followed
  // by "Leave and Discard Changes" deletes it (a new quote also gives its number back; a saved quote goes back to what was saved, nothing of it is touched).
  // ---------------------------------------------------------------------------
  const leave = () => router.push(mode === 'edit' && quote ? `/quotes/${quote.id}` : '/quotes');

  const hasChanges = () => (mode === 'create' ? hasMeaningfulData(read()) : changeSignature(read()) !== originalSig);

  const discardAndLeave = async (quiet: boolean) => {
    setLeaveBusy(true);
    setLeaveError('');
    try {
      await sync.discard();
    } catch (err) {
      if (!quiet) { setLeaveError(err instanceof Error ? err.message : 'Could not discard the changes. Try again.'); setLeaveBusy(false); return; }
    }
    leave();
  };

  const keepAndLeave = async () => {
    setLeaveBusy(true);
    await sync.flush();
    leave();
  };

  const handleCancel = () => {
    if (saving !== null || leaveBusy) return;
    if (hasChanges()) { setLeaveError(''); setLeaveAsk(true); } // something would be lost: ask
    else void discardAndLeave(true); // nothing typed: no reason to keep a draft
  };

  // ---------------------------------------------------------------------------
  // The controls of the system fields
  // ---------------------------------------------------------------------------
  const numberBox = (f: LayoutField, id: string) => {
    const manual = mode === 'create' && settings.numbering.allowManual;
    return (
      <div className="relative w-[329px] max-w-full">
        {manual ? (
          <input id={id} value={manualNumber ?? ''} onChange={e => setManualNumber(e.target.value)} placeholder={shownNumber} maxLength={60} className={inputClass(!!errors[`values.${f.key}`], 'pr-7')} />
        ) : (
          <div id={id} data-quote-number className="w-full h-[34px] border border-[#d7d5e1] rounded-[4px] px-2 pr-7 bg-white text-[13px] flex items-center truncate">{shownNumber}</div>
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

  // Upload Vendor Quote and the Profit Percentage stand next to Task Person
  const vendorBlock = (
    <VendorQuoteUpload
      profitPercent={profitPct}
      onProfitChange={onProfitChange}
      profitError={errors.profitPercent}
      manualRates={manualRateCount(lines)}
      inQuote={new Set(lines.filter(l => l.vendorRate !== undefined && !l.isHeader).map(l => normName(l.name)))}
      canCreate={abilities.create}
      canEdit={abilities.edit}
      disabled={saving !== null}
      onApplied={applyVendor}
    />
  );
  const vendorPlaced = { done: false };

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
      if (f.key === 'salespersonId' && !vendorPlaced.done) {
        vendorPlaced.done = true;
        nodes.push(
          <div key={f.key} className="flex flex-wrap items-start gap-x-[28px] gap-y-[14px]">
            {rowFor(f)}
            {vendorBlock}
          </div>,
        );
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
      const vendorHere = !vendorPlaced.done; // the layout has no Task Person: the controls stand above the item table instead
      vendorPlaced.done = true;
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
          {vendorHere && <div className="px-[20px] pb-[18px]">{vendorBlock}</div>}
          <LineItems title={section.label} markupPct={profitValue ?? 0} lines={lines} setLines={setLines} columns={itemColumns} settings={settings} amounts={totals.lines.map(l => l.amount)} errors={errors} ctx={ctx} canAddItem={abilities.create} canEditItem={abilities.edit} interState={isInterState(values.placeOfSupply, settings.company.stateCode)} aside={right} below={left} />
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

  const busyAny = saving !== null || uploads > 0 || leaveBusy;
  const status = quote?.status;

  // The live preview: the quote drawn from the form as it is now (also what is half typed)
  const previewDto = useMemo(
    () => previewOpen
      ? previewQuote({ quote, settings, values: payloadValues(values), lines, calc, profitPct, customer, picked, users, number: mode === 'create' && settings.numbering.allowManual && manualNumber?.trim() ? manualNumber.trim() : shownNumber })
      : null,
    [previewOpen, quote, settings, payloadValues, values, lines, calc, profitPct, customer, picked, users, mode, manualNumber, shownNumber],
  );
  useEffect(() => {
    // the preview starts open on a wide screen (and then as the person left it)
    const t = setTimeout(() => {
      let pref: string | null = null;
      try { pref = window.localStorage.getItem('minion.quote.preview'); } catch { /* a convenience */ }
      setPreviewOpen(pref === null ? window.innerWidth >= 1500 : pref === '1');
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const togglePreview = () => {
    const next = !previewOpen;
    setPreviewOpen(next);
    try { window.localStorage.setItem('minion.quote.preview', next ? '1' : '0'); } catch { /* a convenience */ }
  };

  // After a conflict: take what the other window saved
  const loadTheirs = () => {
    sync.stop();
    clearBackup(mode === 'edit' ? `edit:${quote?.id}` : sync.draftIdNow() ?? 'new');
    window.location.reload();
  };

  const badge = (() => {
    switch (sync.status) {
      case 'saving':
      case 'dirty':
        return <span className="inline-flex items-center gap-1.5 text-[#6d7189]"><Spinner className="w-3 h-3" /> Saving…</span>;
      case 'saved':
        return <span className="inline-flex items-center gap-1 text-[#2f7d4f]"><Check className="w-3.5 h-3.5" /> Saved{sync.savedAt ? ` · ${sync.savedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>;
      case 'failed':
        return <span className="inline-flex items-center gap-1 text-[#b42318]"><AlertCircle className="w-3.5 h-3.5" /> Save failed</span>;
      case 'conflict':
      case 'gone':
        return <span className="inline-flex items-center gap-1 text-[#8a5a00]"><AlertTriangle className="w-3.5 h-3.5" /> Not saved</span>;
      default:
        return sync.hasCopy ? <span className="inline-flex items-center gap-1 text-[#2f7d4f]"><Check className="w-3.5 h-3.5" /> Draft saved</span> : null;
    }
  })();
  const syncProblem = sync.status === 'failed' || sync.status === 'conflict' || sync.status === 'gone';

  return (
    <div ref={rootRef} className="min-h-screen flex flex-col bg-white">
      <div className="h-[59px] px-[20px] flex items-center gap-[8px] border-b border-[#eeeeee] shrink-0">
        <span className="w-[24px] h-[24px] rounded-[6px] border-[1.5px] border-[#22263b] flex items-center justify-center" aria-hidden><Calculator className="w-4 h-4" /></span>
        <h1 className="text-[22px] font-medium text-black">{mode === 'create' ? 'New Quote' : `Edit Quote${quote ? ` · ${quote.quoteNumber}` : ''}`}</h1>
        <div role="status" aria-live="polite" data-save-status={sync.status} className="ml-3 text-[13px]">{badge}</div>
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={togglePreview} aria-pressed={previewOpen} className={`inline-flex items-center gap-1.5 h-[32px] px-2.5 rounded-[4px] border text-[13px] ${previewOpen ? 'border-[#548df6] bg-[#eef3ff] text-[#2f5fd0]' : 'border-[#d7d5e1] hover:bg-[#f1f1fa]'}`}><Eye className="w-3.5 h-3.5" /> Preview</button>
          {abilities.layout && <button type="button" onClick={() => setLayoutOpen(true)} className="inline-flex items-center gap-1.5 h-[32px] px-2.5 rounded-[4px] border border-[#d7d5e1] text-[13px] hover:bg-[#f1f1fa]"><LayoutTemplate className="w-3.5 h-3.5" /> Edit Page Layout</button>}
          <button type="button" onClick={handleCancel} aria-label="Close" className="text-[#e5484d] hover:bg-[#fdeeee] rounded p-1"><X className="w-5 h-5" /></button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
      <form
        onSubmit={e => { e.preventDefault(); void submit(mode === 'create' ? 'draft' : 'save'); }}
        // Enter in a one-line box (the item name, the reference ...) must not save a long form by accident
        onKeyDown={e => { const t = e.target as HTMLElement; if (e.key === 'Enter' && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'submit') e.preventDefault(); }}
        noValidate
        className="flex-1 min-w-0 flex flex-col"
      >
        <div className="flex-1 pb-[40px]">
          {boot.notice && noticeOpen && (
            <div role="status" data-resume-notice className="mx-[20px] mt-3 flex items-center gap-2 rounded-[4px] border border-[#c8d8f8] bg-[#f1f6ff] px-3 py-2 text-[13px] text-[#22418a]">
              <span className="flex-1">{boot.notice}</span>
              <button type="button" onClick={() => setNoticeOpen(false)} aria-label="Dismiss this message" className="hover:bg-[#dde8fd] rounded p-0.5"><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {syncProblem && (
            <div role="alert" data-save-problem={sync.status} className={`mx-[20px] mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[4px] border px-3 py-2 text-[13px] ${sync.status === 'failed' ? 'border-[#f3c2c4] bg-[#fdeeee] text-[#b42318]' : 'border-[#f2d9a6] bg-[#fff8e6] text-[#8a5a00]'}`}>
              {sync.status === 'failed' ? <AlertCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
              <span className="flex-1 min-w-[200px]">{sync.error}</span>
              {sync.status === 'failed' && <Button onClick={sync.retry}>Try Again</Button>}
              {sync.status === 'conflict' && <><Button kind="blue" onClick={sync.keepMine}>Keep This Version</Button><Button onClick={loadTheirs}>Load the Other Version</Button></>}
              {sync.status === 'gone' && <Button kind="blue" onClick={sync.recreate}>Save This as a New Draft</Button>}
            </div>
          )}
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
          <Button onClick={handleCancel} disabled={saving !== null || leaveBusy}>Cancel</Button>
          {uploads > 0 && <span className="text-[13px] text-[#6d7189] inline-flex items-center gap-2"><Spinner className="w-3.5 h-3.5" /> Uploading files…</span>}
        </div>
      </form>
      {previewOpen && previewDto && <QuotePreview quote={previewDto} layout={layout} settings={settings} images={images} onClose={togglePreview} />}
      </div>

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
      {leaveAsk && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(34,38,59,0.45)] p-3">
          <div role="dialog" aria-modal="true" aria-labelledby="leave-title" className="w-full max-w-[480px] bg-white rounded-[8px] shadow-[0_12px_40px_rgba(34,38,59,0.25)] text-[#22263b]">
            <div className="px-[24px] pt-[24px] pb-[20px]">
              <div className="flex items-center gap-[12px] mb-[16px]">
                <div className="text-[#f59e0b]"><AlertTriangle className="w-[28px] h-[28px]" fill="#fde68a" strokeWidth={1.5} /></div>
                <h2 id="leave-title" className="text-[20px] font-medium text-[#22263b]">Leave this page?</h2>
              </div>
              <div className="text-[14px] text-[#333] pl-[4px] space-y-2">
                {mode === 'create' ? (
                  <>
                    <p>Your quote is saved automatically as a draft{sync.quoteNumber ? ` (${sync.quoteNumber})` : ''}, so closing the page or refreshing never loses it.</p>
                    <p>If you leave and discard, the draft and everything you entered are deleted for good{sync.quoteNumber ? `, and ${sync.quoteNumber} is given back for the next quote` : ''}.</p>
                  </>
                ) : (
                  <>
                    <p>Your changes are saved automatically on the side, so closing the page or refreshing never loses them.</p>
                    <p>If you leave and discard, they are deleted and {quote?.quoteNumber ?? 'the quote'} stays exactly as it was last saved.</p>
                  </>
                )}
              </div>
              {leaveError && <p role="alert" className="mt-3 text-[13px] text-[#b42318]">{leaveError}</p>}
            </div>
            <div className="px-[24px] py-[16px] border-t border-[#ebeaf2] flex flex-wrap items-center gap-[12px]">
              <Button type="button" kind="blue" onClick={() => setLeaveAsk(false)} disabled={leaveBusy}>Continue Editing</Button>
              <Button type="button" kind="ghost" onClick={() => void discardAndLeave(false)} busy={leaveBusy}>Leave and Discard Changes</Button>
              <button type="button" onClick={() => void keepAndLeave()} disabled={leaveBusy} className="ml-auto text-[13px] text-[#548df6] hover:underline disabled:opacity-60">Leave, keep it for later</button>
            </div>
          </div>
        </div>
      )}
      {staleAsk && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(34,38,59,0.45)] p-3">
          <div role="dialog" aria-modal="true" aria-labelledby="stale-title" className="w-full max-w-[480px] bg-white rounded-[8px] shadow-[0_12px_40px_rgba(34,38,59,0.25)] text-[#22263b]">
            <div className="px-[24px] pt-[24px] pb-[20px]">
              <div className="flex items-center gap-[12px] mb-[16px]">
                <div className="text-[#f59e0b]"><AlertTriangle className="w-[28px] h-[28px]" fill="#fde68a" strokeWidth={1.5} /></div>
                <h2 id="stale-title" className="text-[20px] font-medium text-[#22263b]">This quote was changed</h2>
              </div>
              <p className="text-[14px] text-[#333] pl-[4px]">{quote?.quoteNumber ?? 'The quote'} was saved by someone else, or in another window, after you started editing. If you save now, your version replaces theirs.</p>
            </div>
            <div className="px-[24px] py-[16px] border-t border-[#ebeaf2] flex items-center gap-[12px]">
              <Button type="button" kind="blue" onClick={() => { const i = staleAsk; setStaleAsk(null); void submit(i, true); }}>Save and Replace</Button>
              <Button type="button" kind="ghost" onClick={() => setStaleAsk(null)}>Go Back</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
