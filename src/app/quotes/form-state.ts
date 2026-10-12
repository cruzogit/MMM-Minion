// The state of the quote form: the item rows and the calculation panel as typed (text), and the totals they work out to.
// The server works the totals out again from what is sent; this is only what the form shows while you type.

import { calcTotals } from '@/lib/quotes/calc';
import type { CalcOut, ItemDto, LineDto, LineInput, QuoteDto, QuoteSettings, TaxInfo } from '@/lib/quotes/types';
import { normName, numText, sellingRate, strictNumber, type VendorRow } from '@/lib/quotes/vendor-quote';

export type LineState = {
  key: string; // stable while the form is open
  id?: string; // the saved row
  itemId: string | null;
  name: string;
  description: string;
  hsn: string; // the HSN code of Goods, the SAC of a Service
  kind: 'Goods' | 'Service' | ''; // decides HSN or SAC; empty for a line typed by hand
  taskTemplateId: string;
  taskTemplateName: string;
  imageFileId: string | null; // the picture of the item, shown at the left of the row
  unit: string;
  quantity: string;
  rate: string;
  taxId: string;
  custom: Record<string, unknown>;
  showDesc: boolean;
  isHeader?: boolean;
  // Upload Vendor Quote: the vendor's rate this row's selling rate was worked out from (selling = vendor x (1 + profit % / 100)), and whether the
  // selling rate was typed by hand afterwards (then a new profit percentage leaves it alone)
  vendorRate?: string;
  rateManual?: boolean;
};

export type CalcState = { discount: string; shipping: string; wKind: 'TDS' | 'TCS'; wTaxId: string; adjLabel: string; adjustment: string };

let counter = 0;
export const newKey = () => `l_${Date.now().toString(36)}_${(counter++).toString(36)}`;

// A new row starts with the default tax (taxId) of Quote Settings, if there is one
export const blankLine = (taxId = '', isHeader = false): LineState => ({ key: newKey(), itemId: null, name: '', description: '', hsn: '', kind: '', taskTemplateId: '', taskTemplateName: '', imageFileId: null, unit: '', quantity: '1', rate: '', taxId, custom: {}, showDesc: false, isHeader });

// A row that has nothing in it (a Task Template alone does not make it a row: there is no item to do the work for)
export const isBlankLine = (l: LineState) => !l.name.trim() && !l.description.trim() && !l.itemId && !(Number(l.rate) > 0) && !l.hsn.trim() && Object.keys(l.custom).length === 0;

// The tax an item gives a row: a taxable item's Inter State Tax Rate when the quote is for another state (and it has one), else its Intra State Tax Rate, else the
// default tax; an item that is not taxable gives none.
export const itemTaxId = (item: ItemDto, defaultTax = '', interState = false): string =>
  item.taxPreference === 'taxable' ? (interState && item.interTaxId ? item.interTaxId : item.taxId) ?? defaultTax : '';

// The row an item fills in: everything the Item Master holds about it. What was already chosen on the row (its Task Template) stays when the item has none.
// A taxable item that has no tax of its own gets the default tax; an item that is not taxable gets none.
export function lineFromItem(item: ItemDto, base: LineState = blankLine(), defaultTax = '', interState = false): LineState {
  return {
    ...base, itemId: item.id, name: item.name, description: item.description, hsn: item.hsn, kind: item.kind, unit: item.unit, rate: String(item.rate),
    taxId: itemTaxId(item, defaultTax, interState), taskTemplateId: item.taskTemplateId ?? base.taskTemplateId,
    taskTemplateName: item.taskTemplateId ? item.taskTemplateName : base.taskTemplateName, imageFileId: item.imageFileId, showDesc: !!item.description,
  };
}

// The item was changed in the Item Master (Edit item on a row): the row takes the new values of what it still had as the master had it. A rate, a
// description or a tax changed on this quote stays as it is.
export function syncLineWithItem(line: LineState, before: ItemDto, after: ItemDto, defaultTax = '', interState = false): LineState {
  const keep = <T,>(now: T, was: T, becomes: T) => (now === was ? becomes : now);
  const taxOf = (i: ItemDto) => itemTaxId(i, defaultTax, interState); // the tax a row gets from the item
  return {
    ...line,
    name: keep(line.name, before.name, after.name),
    description: keep(line.description, before.description, after.description),
    hsn: keep(line.hsn, before.hsn, after.hsn),
    kind: keep<LineState['kind']>(line.kind, before.kind, after.kind),
    unit: keep(line.unit, before.unit, after.unit),
    rate: Number(line.rate) === before.rate ? String(after.rate) : line.rate,
    taxId: keep(line.taxId, taxOf(before), taxOf(after)),
    taskTemplateId: keep(line.taskTemplateId, before.taskTemplateId ?? '', after.taskTemplateId ?? ''),
    taskTemplateName: line.taskTemplateId === (before.taskTemplateId ?? '') ? after.taskTemplateName : line.taskTemplateName,
    imageFileId: after.imageFileId,
    showDesc: line.showDesc || !!after.description,
  };
}

export function lineFromDto(l: LineDto): LineState {
  const { vendorRate, rateManual, ...custom } = l.custom ?? {};
  return {
    key: newKey(), id: l.id, itemId: l.itemId, name: l.name, description: l.description, hsn: l.hsn, kind: l.kind ?? '', taskTemplateId: l.taskTemplateId ?? '', taskTemplateName: l.taskTemplateName,
    imageFileId: l.imageFileId, unit: l.unit, quantity: String(l.quantity), rate: String(l.rate), taxId: l.taxId ?? '', custom, showDesc: !!l.description,
    isHeader: l.custom?.isHeader === true,
    ...(typeof vendorRate === 'number' ? { vendorRate: numText(vendorRate), ...(rateManual === true ? { rateManual: true } : {}) } : {}),
  };
}

export const emptyCalc = (): CalcState => ({ discount: '', shipping: '', wKind: 'TDS', wTaxId: '', adjLabel: 'Adjustment', adjustment: '' });

export function calcFromDto(c: QuoteDto['calc']): CalcState {
  return {
    discount: c.discountPercent ? String(c.discountPercent) : '', shipping: c.shippingCharges ? String(c.shippingCharges) : '', wKind: c.withholding?.kind ?? 'TDS', wTaxId: c.withholding?.taxId ?? '',
    adjLabel: c.adjustmentLabel || 'Adjustment', adjustment: c.adjustment ? String(c.adjustment) : '',
  };
}

export function toNumber(s: string | number): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const n = Number(String(s).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export function taxInfo(settings: QuoteSettings, id: string): TaxInfo | null {
  const t = settings.taxes.find(x => x.id === id);
  return t ? { id: t.id, name: t.name, rate: t.rate, components: t.components } : null;
}

export function computeTotals(lines: LineState[], calc: CalcState, settings: QuoteSettings): CalcOut {
  const list = calc.wKind === 'TDS' ? settings.tds : settings.tcs;
  const w = calc.wTaxId ? list.find(x => x.id === calc.wTaxId) : undefined;
  return calcTotals({
    lines: lines.map(l => ({ quantity: toNumber(l.quantity), rate: toNumber(l.rate), tax: l.taxId ? taxInfo(settings, l.taxId) : null })),
    discountPercent: Math.min(100, Math.max(0, toNumber(calc.discount))),
    shipping: toNumber(calc.shipping),
    withholding: w ? { kind: calc.wKind, id: w.id, name: w.name, rate: w.rate } : null,
    adjustment: toNumber(calc.adjustment),
    rounding: settings.rounding.mode,
  });
}

// A number as typed: a number when it is one, otherwise the text itself (so the server explains what is wrong instead of reading it as 0)
export function numberOrText(s: string, empty: number): number | string {
  const t = s.replace(/,/g, '').trim();
  if (t === '') return empty;
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : s;
}

// What the API takes for a row
export function lineToInput(l: LineState): LineInput {
  return {
    ...(l.id ? { id: l.id } : {}), itemId: l.itemId, name: l.name, description: l.description, hsn: l.hsn, kind: l.kind || null, taskTemplateId: l.taskTemplateId || null, unit: l.unit,
    quantity: numberOrText(l.quantity, 1) as number, rate: numberOrText(l.rate, 0) as number, taxId: l.taxId || null,
    custom: {
      ...(l.isHeader ? { ...l.custom, isHeader: true } : l.custom),
      ...(l.vendorRate !== undefined && !l.isHeader ? { vendorRate: numberOrText(l.vendorRate, 0), ...(l.rateManual ? { rateManual: true } : {}) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Upload Vendor Quote
// ---------------------------------------------------------------------------
const fromVendor = (l: LineState): number | null => (l.vendorRate !== undefined && !l.isHeader ? strictNumber(l.vendorRate) : null);

/**
 * The profit percentage was set or changed: every row that came from a vendor quote gets vendor rate x (1 + profit % / 100), always worked out from the
 * vendor's rate (so it never compounds). A row whose selling rate was typed by hand is left as it is; rows typed in the quote have no vendor rate and are not touched.
 */
export function applyMarkup(lines: LineState[], profitPercent: number): LineState[] {
  return lines.map(l => {
    const base = fromVendor(l);
    return base === null || l.rateManual ? l : { ...l, rate: numText(sellingRate(base, profitPercent)) };
  });
}

/** How many rows keep a selling rate that was typed by hand (the profit percentage does not change them) */
export const manualRateCount = (lines: LineState[]): number => lines.filter(l => l.rateManual && fromVendor(l) !== null).length;

/** "Use profit percentage" on a row: the hand-typed selling rate is given back to the percentage */
export function resetRateToMarkup(line: LineState, profitPercent: number): LineState {
  const base = fromVendor(line);
  if (base === null) return line;
  const { rateManual: _manual, ...rest } = line;
  void _manual;
  return { ...rest, rate: numText(sellingRate(base, profitPercent)) };
}

/** A quote row from a reviewed row of the vendor quote: what the Items module holds about the item (tax, HSN/SAC, unit, Task Template) plus what was reviewed (name, description, quantity) */
export function vendorLine(row: VendorRow, item: ItemDto | null, opts: { defaultTax: string; interState: boolean; profitPercent: number }): LineState {
  const base = blankLine(opts.defaultTax);
  const quantity = strictNumber(row.quantity) ?? 1;
  const vendor = strictNumber(row.rate) ?? 0;
  const fromItem = item ? lineFromItem(item, base, opts.defaultTax, opts.interState) : { ...base, unit: row.unit.trim() || 'nos' };
  const description = row.description.trim() || fromItem.description;
  return {
    ...fromItem,
    name: row.name.replace(/\s+/g, ' ').trim(),
    description,
    showDesc: !!description,
    quantity: numText(quantity),
    vendorRate: numText(vendor),
    rate: numText(sellingRate(vendor, opts.profitPercent)),
  };
}

/**
 * Puts the rows of a vendor quote into the quote: a row whose name (compared as in the Items module) is on a row that came from a vendor quote
 * already updates that row (quantity, vendor rate, description, and the selling rate unless it was typed by hand) instead of adding a second one, so
 * uploading the same file again changes nothing. Rows typed in the quote, headings and other items are never touched. Empty rows at the end are dropped.
 */
export function mergeVendorLines(current: LineState[], incoming: LineState[]): { lines: LineState[]; added: number; updated: number } {
  const lines = current.slice();
  while (lines.length && isBlankLine(lines[lines.length - 1])) lines.pop();
  const used = new Set<string>();
  let added = 0;
  let updated = 0;
  for (const inc of incoming) {
    const at = lines.findIndex(l => !used.has(l.key) && fromVendor(l) !== null && normName(l.name) === normName(inc.name));
    if (at < 0) {
      lines.push(inc);
      used.add(inc.key);
      added++;
      continue;
    }
    const prev = lines[at];
    lines[at] = {
      ...prev,
      quantity: inc.quantity,
      vendorRate: inc.vendorRate,
      rate: prev.rateManual ? prev.rate : inc.rate,
      description: inc.description || prev.description,
      showDesc: prev.showDesc || !!inc.description,
      itemId: prev.itemId ?? inc.itemId,
      hsn: prev.hsn || inc.hsn,
      kind: prev.kind || inc.kind,
      taskTemplateId: prev.taskTemplateId || inc.taskTemplateId,
      taskTemplateName: prev.taskTemplateName || inc.taskTemplateName,
      imageFileId: prev.imageFileId ?? inc.imageFileId,
    };
    used.add(prev.key);
    updated++;
  }
  return { lines: lines.length ? lines : [blankLine()], added, updated };
}
