// The quote as the live preview draws it: built from the form as it is now (also what is half typed), never from the database, so the preview follows
// every key stroke. It is the same QuoteDto that a saved quote has, so the preview goes through the same buildDoc as the Quote Details page and the PDF.

import type { LookupItem, RecordRefs } from '@/lib/records/types';
import type { CustomerDto, QuoteDto, QuoteSettings } from '@/lib/quotes/types';
import { isBlankLine, computeTotals, toNumber, type CalcState, type LineState } from './form-state';
import { parseProfitPercent } from '@/lib/quotes/vendor-quote';

export type PreviewInput = {
  quote?: QuoteDto; // the saved quote being edited (its refs and status are the base)
  settings: QuoteSettings;
  values: Record<string, unknown>; // the header fields as the API takes them (a day is YYYY-MM-DD ...)
  lines: LineState[];
  calc: CalcState;
  profitPct: string;
  customer: CustomerDto | null;
  picked: Record<string, string>; // the words shown for the people / deals / projects that were picked
  users: LookupItem[];
  number: string; // the number the quote has, or the one it will get
};

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function previewQuote(p: PreviewInput): QuoteDto {
  const { settings, calc } = p;
  const totals = computeTotals(p.lines, calc, settings);

  // A row with nothing in it is not on the quote; a half-typed row is
  const shown: { line: LineState; at: number }[] = [];
  p.lines.forEach((line, at) => { if (line.isHeader ? !!line.name.trim() : !isBlankLine(line)) shown.push({ line, at }); });

  const lines: QuoteDto['lines'] = shown.map(({ line: l, at }) => {
    const tax = !l.isHeader && l.taxId ? settings.taxes.find(t => t.id === l.taxId) : undefined;
    return {
      id: l.id ?? l.key,
      itemId: l.itemId,
      name: l.name,
      description: l.description,
      hsn: l.hsn,
      kind: l.kind || null,
      taskTemplateId: l.taskTemplateId || null,
      taskTemplateName: l.taskTemplateName,
      imageFileId: l.imageFileId,
      unit: l.unit,
      quantity: toNumber(l.quantity),
      rate: toNumber(l.rate),
      taxId: l.taxId || null,
      taxName: tax?.name ?? null,
      taxRate: tax?.rate ?? null,
      amount: l.isHeader ? 0 : totals.lines[at]?.amount ?? 0,
      custom: l.isHeader ? { ...l.custom, isHeader: true } : l.custom,
    };
  });

  // The people and the deal / project that were picked: the words the form showed
  const refs: RecordRefs = {
    users: { ...(p.quote?.refs.users ?? {}), ...Object.fromEntries(p.users.map(u => [u.id, u.label])) },
    deals: { ...(p.quote?.refs.deals ?? {}) },
    materialVendors: p.quote?.refs.materialVendors ?? {},
    serviceVendors: p.quote?.refs.serviceVendors ?? {},
    lookups: { ...(p.quote?.refs.lookups ?? {}) },
  };
  const dealId = text(p.values.dealId);
  if (dealId && !refs.deals[dealId]) refs.deals[dealId] = { code: p.picked[dealId] ?? '', name: '', customer: null, closed: false };
  const projectId = text(p.values.projectId);
  if (projectId && p.picked[projectId]) refs.lookups = { ...refs.lookups, project: { ...(refs.lookups?.project ?? {}), [projectId]: p.picked[projectId] } };

  const list = calc.wKind === 'TDS' ? settings.tds : settings.tcs;
  const w = calc.wTaxId ? list.find(x => x.id === calc.wTaxId) : undefined;
  const profit = parseProfitPercent(p.profitPct);

  return {
    id: p.quote?.id ?? 'preview',
    quoteNumber: p.number,
    numberSeries: p.quote?.numberSeries ?? null,
    numberSeq: p.quote?.numberSeq ?? null,
    status: p.quote?.status ?? 'Draft',
    values: p.values,
    lines,
    calc: {
      discountPercent: Math.min(100, Math.max(0, toNumber(calc.discount))),
      shippingCharges: toNumber(calc.shipping),
      withholding: w ? { kind: calc.wKind, taxId: w.id, name: w.name, rate: w.rate } : null,
      adjustmentLabel: calc.adjLabel.trim() || 'Adjustment',
      adjustment: toNumber(calc.adjustment),
    },
    totals: { ...totals, lines: shown.map(({ at }) => totals.lines[at] ?? { amount: 0, discount: 0, taxable: 0, tax: 0 }) },
    profitPercent: profit,
    refs,
    customer: p.customer,
    files: p.quote?.files ?? [],
    share: p.quote?.share ?? { token: null, url: null, expiresAt: null },
    createdBy: p.quote?.createdBy ?? null,
    createdAt: p.quote?.createdAt ?? '',
    updatedAt: p.quote?.updatedAt ?? '',
  };
}
