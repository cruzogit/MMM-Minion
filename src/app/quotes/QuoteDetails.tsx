'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { formatBytes } from '@/lib/leads/image-optimize';
import { displayValue, isEmptyValue } from '@/lib/records/values';
import type { FileDto, LayoutField, ModuleLayoutDto } from '@/lib/records/types';
import { formatAmount, formatMoney, formatQuantity } from '@/lib/quotes/format';
import type { QuoteDto, QuoteSettings } from '@/lib/quotes/types';
import { StatusText } from './ui';

// The Quote Details view: everything the quote holds, laid out by the Quote layout (Edit Page Layout), including what the PDF leaves out
export default function QuoteDetails({ quote, layout, settings }: { quote: QuoteDto; layout: ModuleLayoutDto; settings: QuoteSettings }) {
  const { display } = settings;
  const kinds = new Map(layout.sections.map(s => [s.id, s.kind]));
  const itemCols = layout.fields.filter(f => f.section === 'items' && f.enabled);
  const colOn = (k: string) => itemCols.find(c => c.key === k);
  const custom = itemCols.filter(c => !c.isSystem);
  const t = quote.totals;
  const money = (n: number) => formatMoney(n, display.currencySymbol, display.grouping);
  const amount = (n: number) => formatAmount(n, display.grouping);

  const textOf = (f: LayoutField): string => {
    const raw = quote.values[f.key];
    if (f.key === 'quoteNumber') return quote.quoteNumber;
    if (f.key === 'customerId') return quote.customer?.name ?? '';
    if (isEmptyValue(raw) && f.type !== 'CHECKBOX') return '';
    return displayValue(f, raw, quote.refs);
  };

  const sections = layout.sections.filter(s => kinds.get(s.id) === 'FORM' && s.id !== 'notes' && s.id !== 'terms');
  const bigText = (key: string) => {
    const f = layout.fields.find(x => x.key === key);
    const v = quote.values[key];
    return f && f.enabled && typeof v === 'string' && v.trim() ? { label: f.label, value: v } : null;
  };
  const notes = bigText('notes');
  const terms = bigText('terms');
  const files = layout.fields.filter(f => f.type === 'FILE' && f.enabled && kinds.get(f.section) === 'FORM').flatMap(f => ((quote.values[f.key] as FileDto[]) ?? []).map(file => ({ field: f.label, file })));

  return (
    <div className="space-y-6 text-[13px]" data-quote-details>
      {/* Header information */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-1">
        {sections.flatMap(s => layout.fields.filter(f => f.section === s.id && f.enabled && f.type !== 'FILE' && f.type !== 'CALC')).map(f => {
          const v = textOf(f);
          if (!v && f.key !== 'quoteNumber') return null;
          return (
            <div key={f.key} className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 py-[5px]" data-field={f.key}>
              <div className="text-[#6d7189]">{f.label}</div>
              <div className="text-[#22263b] break-words whitespace-pre-line">
                {f.key === 'customerId' && quote.customer ? <Link href={`/quotes?customer=${quote.customer.id}`} className="text-[#355bd4] hover:underline">{v}</Link> : v}
                {f.key === 'customerId' && quote.customer?.gstin ? <span className="block text-[12px] text-[#6d7189]">GSTIN {quote.customer.gstin}</span> : null}
              </div>
            </div>
          );
        })}
        <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-x-3 py-[5px]"><div className="text-[#6d7189]">Quote Status</div><div><StatusText status={quote.status} /></div></div>
      </div>

      {/* Items */}
      <div className="border border-[#ebeaf2] rounded-[6px] overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse">
          <thead>
            <tr className="bg-[#f9f9fb] border-b border-[#ebeaf2] text-[11px] uppercase text-[#6d7189] h-[36px]">
              <th className="text-left px-3 font-medium w-[40px]">#</th>
              <th className="text-left px-3 font-medium">{colOn('name')?.label ?? 'Item Details'}</th>
              {colOn('taskTemplateId') && <th className="text-left px-3 font-medium">{colOn('taskTemplateId')!.label}</th>}
              {colOn('hsn') && <th className="text-left px-3 font-medium">{colOn('hsn')!.label}</th>}
              {custom.map(c => <th key={c.key} className="text-left px-3 font-medium">{c.label}</th>)}
              {colOn('quantity') && <th className="text-right px-3 font-medium">{colOn('quantity')!.label}</th>}
              {colOn('rate') && <th className="text-right px-3 font-medium">{colOn('rate')!.label}</th>}
              {colOn('taxId') && <th className="text-left px-3 font-medium">{colOn('taxId')!.label}</th>}
              <th className="text-right px-3 font-medium">{colOn('lineAmount')?.label ?? 'Amount'}</th>
            </tr>
          </thead>
          <tbody>
            {quote.lines.map((l, i) => l.custom?.isHeader === true ? (
              <tr key={l.id} className="border-b border-[#ebeaf2] bg-[#f9f9fb]" data-line-header>
                <td colSpan={9} className="px-3 py-2 font-semibold">{l.name}</td>
              </tr>
            ) : (
              <tr key={l.id} className="align-top border-b border-[#ebeaf2] last:border-b-0" data-line>
                <td className="px-3 py-2 text-[#6d7189]">{quote.lines.slice(0, i).filter(x => x.custom?.isHeader !== true).length + 1}</td>
                <td className="px-3 py-2"><div className="font-medium">{l.name}</div>{l.description && <div className="text-[12px] text-[#6d7189] whitespace-pre-line">{l.description}</div>}{l.hsn && !colOn('hsn') && <div className="text-[12px] text-[#6d7189]">{l.kind === 'Service' ? 'SAC' : l.kind === 'Goods' ? 'HSN' : 'HSN/SAC'} : {l.hsn}</div>}</td>
                {colOn('taskTemplateId') && <td className="px-3 py-2">{l.taskTemplateName}</td>}
                {colOn('hsn') && <td className="px-3 py-2">{l.hsn}</td>}
                {custom.map(c => <td key={c.key} className="px-3 py-2">{displayValue(c, l.custom[c.key], quote.refs)}</td>)}
                {colOn('quantity') && <td className="px-3 py-2 text-right whitespace-nowrap">{formatQuantity(l.quantity)}{l.unit ? ` ${l.unit}` : ''}</td>}
                {colOn('rate') && <td className="px-3 py-2 text-right">{amount(l.rate)}</td>}
                {colOn('taxId') && <td className="px-3 py-2 whitespace-nowrap">{l.taxName ? `${l.taxName} [${l.taxRate}%]` : ''}</td>}
                <td className="px-3 py-2 text-right font-medium">{amount(l.amount)}</td>
              </tr>
            ))}
            {quote.lines.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[#6d7189]">There are no items on this quote.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="flex justify-end">
        <div className="w-full sm:w-[380px] rounded-[8px] bg-[#f9f9fb] px-4 py-3 space-y-[6px]">
          <Row k="Sub Total" v={amount(t.subTotal)} bold />
          {t.discountAmount > 0 && <Row k={`Discount${quote.calc.discountPercent ? ` (${quote.calc.discountPercent}%)` : ''}`} v={`-${amount(t.discountAmount)}`} />}
          {t.taxes.map(x => <Row key={`${x.name}-${x.rate}`} k={`${x.name} (${x.rate}%)`} v={amount(x.amount)} />)}
          {t.shipping !== 0 && <Row k="Shipping Charges" v={amount(t.shipping)} />}
          {quote.calc.withholding && <Row k={`${quote.calc.withholding.kind} · ${quote.calc.withholding.name} [${quote.calc.withholding.rate}%]`} v={`${t.withholdingAmount < 0 ? '-' : ''}${amount(Math.abs(t.withholdingAmount))}`} />}
          {t.adjustment !== 0 && <Row k={quote.calc.adjustmentLabel || 'Adjustment'} v={`${t.adjustment < 0 ? '-' : ''}${amount(Math.abs(t.adjustment))}`} />}
          {t.roundOff !== 0 && <Row k="Round Off" v={`${t.roundOff < 0 ? '-' : ''}${amount(Math.abs(t.roundOff))}`} />}
          <div className="border-t border-[#ebeaf2] pt-2 flex justify-between text-[15px] font-semibold text-black"><span>Total ( {display.currencySymbol} )</span><span data-detail-total>{money(t.total)}</span></div>
        </div>
      </div>

      {(notes || terms) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {notes && <div><div className="text-[#6d7189] mb-1">{notes.label}</div><div className="whitespace-pre-line">{notes.value}</div></div>}
          {terms && <div><div className="text-[#6d7189] mb-1">{terms.label}</div><div className="whitespace-pre-line">{terms.value}</div></div>}
        </div>
      )}

      {files.length > 0 && (
        <div>
          <div className="text-[#6d7189] mb-2">Attachments</div>
          <ul className="flex flex-wrap gap-2">
            {files.map(({ field, file }) => (
              <li key={file.id} className="flex items-center gap-1.5 border border-[#ebeaf2] rounded-[4px] bg-white px-2 py-1 text-[12px]" title={field}>
                <FileText className="w-3.5 h-3.5 text-[#9ca0ab]" aria-hidden />
                {file.url ? <a href={file.url} target="_blank" rel="noopener noreferrer" className="text-[#355bd4] hover:underline">{file.fileName}</a> : file.fileName}
                <span className="text-[#9ca0ab]">{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between gap-3 ${bold ? 'font-semibold text-black' : ''}`}><span className={bold ? '' : 'text-[#6d7189]'}>{k}</span><span>{v}</span></div>;
}
