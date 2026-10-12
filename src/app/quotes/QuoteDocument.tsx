import { formatAmount, formatMoney, formatQuantity } from '@/lib/quotes/format';
import type { DocHeaderRow, QuoteDoc } from '@/lib/quotes/doc';
import { WATERMARK } from '@/lib/quotes/watermark';
import { DOC_FONT_FAMILY } from './doc-font';

// The quote as a printed page: company, customer, items, totals, notes, bank details, terms, signature. Drawn from one model (QuoteDoc) so
// the Quote Details page, the print / PDF page and the page a customer opens with the share link all look the same. Fixed A4 width.
// Measured against the reference page (Zoho Books): text is 8pt (10.67px), the company name 12pt, the title 22pt, labels #333.
// The status band (Sent, Accepted ...) is not drawn here: it belongs to the CRM viewer (StatusBand), so a printout or a PDF never has it.
// The logo is a watermark behind the whole page, the item table included (the box has no white of its own). The PDF (forPdf) is drawn on a see-through
// background and puts the watermark on every page itself, so a page that is cut is not left without it.
const line = '1px solid #9e9e9e';
const body = 'text-[10.67px]';

// One column of "label : value" rows under the company block
function HeaderColumn({ rows }: { rows: DocHeaderRow[] }) {
  return (
    <div className="px-[7px]" style={{ minHeight: 49 }}>
      {rows.map(r => (
        <div key={`${r.label}|${r.value}`} className={`flex ${body} leading-[19px]`}>
          <span className="shrink-0 text-[#333]" style={{ width: 161 }}>{r.label}</span>
          <span className="min-w-0 break-words font-bold text-black">: {r.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function QuoteDocument({ doc, watermark = true, forPdf = false }: { doc: QuoteDoc; watermark?: boolean; forPdf?: boolean }) {
  const { company, customer, totals, currency } = doc;
  const money = (n: number) => formatMoney(n, currency.symbol, currency.grouping);
  const amount = (n: number) => formatAmount(n, currency.grouping);
  const qty = doc.lines.reduce((a, l) => (l.isHeader ? a : a + l.quantity), 0);

  const totalRows: { key: string; label: string; value: string; bold?: boolean }[] = [{ key: 'sub', label: 'Sub Total', value: amount(totals.subTotal) }];
  if (totals.discountAmount > 0) totalRows.push({ key: 'disc', label: `Discount${doc.calc.discountPercent ? ` (${doc.calc.discountPercent}%)` : ''}`, value: `(-) ${amount(totals.discountAmount)}` });
  for (const t of totals.taxes) totalRows.push({ key: `tax-${t.name}-${t.rate}`, label: `${t.name} (${t.rate}%)`, value: amount(t.amount) });
  if (totals.shipping !== 0) totalRows.push({ key: 'ship', label: 'Shipping Charges', value: amount(totals.shipping) });
  if (doc.calc.withholding) {
    const w = doc.calc.withholding;
    totalRows.push({ key: 'wh', label: `${w.kind === 'TDS' ? 'TDS' : 'TCS'} (${w.rate}%)`, value: `${totals.withholdingAmount < 0 ? '(-) ' : ''}${amount(Math.abs(totals.withholdingAmount))}` });
  }
  if (totals.adjustment !== 0) totalRows.push({ key: 'adj', label: doc.calc.adjustmentLabel || 'Adjustment', value: `${totals.adjustment < 0 ? '-' : ''}${amount(Math.abs(totals.adjustment))}` });
  if (totals.roundOff !== 0) totalRows.push({ key: 'round', label: 'Rounding', value: `${totals.roundOff < 0 ? '-' : ''}${amount(Math.abs(totals.roundOff))}` });
  totalRows.push({ key: 'total', label: 'Total', value: money(totals.total), bold: true });

  return (
    <div
      data-quote-document
      className={`relative text-black mx-auto ${forPdf ? '' : 'bg-white'}`}
      style={{ width: 794, minHeight: 1123, padding: '68px 40px 48px 53px', fontFamily: DOC_FONT_FAMILY }}
    >
      {watermark && !forPdf && company.logo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={company.logo} crossOrigin="anonymous" alt="" aria-hidden data-watermark className="absolute print:fixed pointer-events-none select-none"
          style={{ top: WATERMARK.centerY, left: WATERMARK.centerX - WATERMARK.width / 2, width: WATERMARK.width, opacity: WATERMARK.opacity, transform: 'translateY(-50%)' }} />
      )}

      <div data-pdf-box className="relative" style={{ border: line }}>
        {/* Company and title */}
        <div className="flex" style={{ minHeight: 180 }}>
          <div className="flex-1 min-w-0 flex">
            {company.logo && (
              <div className="shrink-0 flex items-center" style={{ width: 180, paddingLeft: 21, paddingBottom: 6 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={company.logo} crossOrigin="anonymous" alt={company.name ? `${company.name} logo` : 'Logo'} data-company-logo style={{ width: 130, maxHeight: 130, objectFit: 'contain' }} />
              </div>
            )}
            <div className="min-w-0 py-[3px] pr-2" style={{ paddingLeft: company.logo ? 0 : 10 }}>
              {company.name && <div className="font-bold uppercase text-[#307aab]" style={{ fontSize: 16, lineHeight: '16px', maxWidth: 270 }}>{company.name}</div>}
              <div className={`mt-[6px] ${body} leading-[17px] text-black`}>
                {company.registration && <div>{company.registration}</div>}
                {company.address.map((l, i) => <div key={i}>{l}</div>)}
                {company.gstin && <div>GSTIN {company.gstin}</div>}
                {company.phone && <div>{company.phone}</div>}
                {company.email && <div>{company.email}</div>}
                {company.website && <div>{company.website}</div>}
              </div>
            </div>
          </div>
          <div className="shrink-0 flex items-end justify-end text-right" style={{ width: 190, padding: '0 6px 8px 0' }}>
            <div className="uppercase" style={{ color: '#be9525', fontSize: 29.33, lineHeight: '47px', maxWidth: 170 }}>{doc.title}</div>
          </div>
        </div>

        {/* Number and date | place of supply and task person (the rows are set in Edit Page Layout) */}
        <div className="grid grid-cols-2" style={{ borderTop: line }}>
          <div style={{ borderRight: line }}><HeaderColumn rows={doc.headerLeft} /></div>
          <div><HeaderColumn rows={doc.headerRight} /></div>
        </div>

        {/* To */}
        <div className={`bg-[#f2f3f4] px-[7px] ${body} font-bold leading-[19px] text-[#333]`} style={{ borderTop: line }}>To:</div>
        <div className="px-[7px] pt-[4px] pb-[10px]" style={{ borderTop: line }}>
          <div className={customer.shipTo.length ? 'grid grid-cols-2 gap-x-[14px]' : ''}>
            <div>
              <div className="font-bold text-[#548df6]" style={{ fontSize: 12, lineHeight: '17px' }}>{customer.name}</div>
              <div className={`${body} leading-[15px] text-black`}>
                {customer.address.map((l, i) => <div key={i}>{l}</div>)}
                {customer.gstin && <div>GSTIN {customer.gstin}</div>}
              </div>
            </div>
            {customer.shipTo.length > 0 && (
              <div>
                <div className="font-bold text-[#333]" style={{ fontSize: 12, lineHeight: '17px' }}>Ship To</div>
                <div className={`${body} leading-[15px] text-black`}>{customer.shipTo.map((l, i) => <div key={i}>{l}</div>)}</div>
              </div>
            )}
          </div>
        </div>

        {doc.subject && (
          <div className={`px-[7px] py-[5px] ${body} leading-[15px]`} style={{ borderTop: line }}><span className="font-bold">Subject : </span>{doc.subject}</div>
        )}

        {/* Items */}
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed', borderTop: line }}>
          <colgroup>
            <col style={{ width: 35 }} />
            <col />
            {doc.extraColumns.map(c => <col key={c.key} style={{ width: 80 }} />)}
            <col style={{ width: 77 }} />
            <col style={{ width: 77 }} />
            <col style={{ width: 91 }} />
          </colgroup>
          <thead>
            <tr className={`bg-[#f2f3f4] ${body} font-bold leading-[22px]`}>
              <th className="text-left px-[7px] pt-[2px]" style={{ borderRight: line }}>S.No</th>
              <th className="text-left px-[7px] pt-[2px]" style={{ borderRight: line }}>Item &amp; Description</th>
              {doc.extraColumns.map(c => <th key={c.key} className="text-left px-[7px] pt-[2px]" style={{ borderRight: line }}>{c.label}</th>)}
              <th className="text-right px-[7px] pt-[2px]" style={{ borderRight: line }}>Qty</th>
              <th className="text-right px-[7px] pt-[2px]" style={{ borderRight: line }}>Rate</th>
              <th className="text-right px-[7px] pt-[2px]">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((l, i) => l.isHeader ? (
              <tr key={`h-${i}`} className={`align-top ${body}`} style={{ borderTop: line }}>
                <td colSpan={5 + doc.extraColumns.length} className="px-[7px] py-[6px] font-bold" style={{ borderRight: line }}>{l.name}</td>
              </tr>
            ) : (
              <tr key={l.no!} className={`align-top ${body}`} style={{ borderTop: line }}>
                <td className="px-[7px] pt-[1px] pb-[20px] text-center leading-[19px]" style={{ borderRight: line, height: 72 }}>{l.no}</td>
                <td className="px-[7px] pt-[1px] pb-[20px] leading-[17px]" style={{ borderRight: line }}>
                  <div className="whitespace-pre-line font-bold">{l.name}</div>
                  {l.description && <div className="whitespace-pre-line text-[9px] mt-[2px]">{l.description}</div>}
                  {l.hsn && <div className="text-[9px] mt-[2px]">{l.taxCodeLabel} : {l.hsn}</div>}
                </td>
                {doc.extraColumns.map(c => <td key={c.key} className="px-[7px] pt-[1px] pb-[20px] leading-[17px]" style={{ borderRight: line }}>{l.extra[c.key]}</td>)}
                <td className="px-[7px] pt-[1px] pb-[20px] text-right leading-[19px]" style={{ borderRight: line }}>
                  <div>{formatQuantity(l.quantity)}</div>
                  {(doc.showUnit || l.unit) && l.unit && <div>{l.unit}</div>}
                </td>
                <td className="px-[7px] pt-[1px] pb-[20px] text-right leading-[19px]" style={{ borderRight: line }}>{amount(l.rate)}</td>
                <td className="px-[7px] pt-[1px] pb-[20px] text-right leading-[19px]">{amount(l.amount)}</td>
              </tr>
            ))}
            {doc.lines.length === 0 && (
              <tr style={{ borderTop: line }}><td colSpan={5 + doc.extraColumns.length} className={`px-[7px] py-6 text-center ${body} text-[#555]`}>No items.</td></tr>
            )}
          </tbody>
        </table>

        {/* Words, notes, bank, terms | totals, signature */}
        <div className="flex" style={{ borderTop: line }}>
          <div className="min-w-0 px-[8px] pt-[8px] pb-[10px]" style={{ width: 395, borderRight: line }}>
            <div className={`${body} leading-[17px] text-black`}>Items in Total {formatQuantity(qty)}</div>
            <div className={`${body} leading-[17px] text-black mt-[10px]`}>Total In Words</div>
            <div className={`${body} leading-[17px] font-bold italic text-black`}>{doc.words}</div>
            {doc.notes && (
              <div className="mt-[16px]">
                <div className={`${body} leading-[17px] text-[#333]`}>Notes</div>
                <div className={`${body} leading-[17px] text-black whitespace-pre-line`}>{doc.notes}</div>
              </div>
            )}
            {company.bank.length > 0 && (
              <div className={`mt-[20px] ${body} leading-[17px]`}>
                <div className="font-bold">Company&apos;s Bank Details</div>
                <div className="grid" style={{ gridTemplateColumns: 'minmax(59px, max-content) minmax(0, 1fr)' }}>
                  {company.bank.map(b => (
                    <div key={b.label} className="contents"><span>{b.label}</span><span className="font-bold break-words">: {b.value}</span></div>
                  ))}
                </div>
              </div>
            )}
            {doc.terms && (
              <div className="mt-[20px]">
                <div className={`${body} leading-[17px] text-[#333]`}>Terms &amp; Conditions</div>
                <div className={`${body} leading-[17px] text-black whitespace-pre-line`}>{doc.terms}</div>
              </div>
            )}
          </div>
          <div data-pdf-keep className="flex-1 min-w-0 flex flex-col">
            <div className="pl-[10px] pr-[8px] pt-[3px] pb-[2px]" style={{ borderBottom: line }}>
              {totalRows.map(r => (
                <div key={r.key} className={`flex justify-end ${body} leading-[21px]`}>
                  <span className={`text-right pr-[13px] ${r.bold ? 'font-bold' : ''}`} style={{ flex: 1 }}>{r.label}</span>
                  <span className={`text-right ${r.bold ? 'font-bold' : ''}`} style={{ width: 98 }}>{r.value}</span>
                </div>
              ))}
            </div>
            <div className="flex-1 flex flex-col items-center pb-[6px]" style={{ minHeight: 272 }}>
              <div className="flex-1 w-full flex items-center justify-center">
                {company.signature && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={company.signature} crossOrigin="anonymous" alt="Authorised signature" style={{ width: 'auto', height: 'auto', maxWidth: 150, maxHeight: 150, objectFit: 'contain' }} />
                )}
              </div>
              <div className={body}>Authorized Signature</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
