'use client';

import { useState } from 'react';
import { Clock, IndianRupee } from 'lucide-react';
import type { LayoutSection } from '@/lib/records/types';
import type { ProjectDetail, ProjectRow } from '@/lib/projects/types';
import { buildColumns, moneyCell, RowField, Section, SectionTable, useProject } from './common';
import { HistoryPopup, PaymentPopup } from './VendorPopups';

// SERVICE VENDOR INVOLVEMENT: a row for every Service Vendor chosen in Vendor Selection (MP1S1, MP1S2 ...). Start / Started and Completion / Completed
// are four dates the person fills in; Duration is worked out from them (planned / actual). Given Amount comes from the Pre-Payment Records of the deal.
// The Payment icon makes a Pre-Payment Record for this vendor; the History icon lists them.
export default function ServiceVendorSection({ section }: { section: LayoutSection }) {
  const { detail, layout, canEdit, call, fail } = useProject();
  const [paying, setPaying] = useState<ProjectRow | null>(null);
  const [history, setHistory] = useState<ProjectRow | null>(null);
  const columns = buildColumns(layout, section.id, [['serviceStartDate', 'serviceStartedDate'], ['serviceCompletionDate', 'serviceCompletedDate']]);
  const nameOf = (row: ProjectRow) => {
    const v = detail.refs.serviceVendors[String(row.meta.vendorId)];
    return v ? `${v.code} - ${v.name}` : String(row.meta.vendorId);
  };
  const iconButton = 'inline-flex h-8 w-8 items-center justify-center rounded text-[#1a56c4] hover:bg-[#eaf3ff] disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent';

  return (
    <Section id={section.id} title={section.label}>
      <SectionTable
        columns={columns}
        rows={detail.serviceVendors}
        empty="Choose Service Vendors in Vendor Selection and they appear here."
        rowClass={row => (row.meta.selected ? '' : 'bg-gray-50 text-gray-500')}
        cell={(f, row, i) => {
          switch (f.key) {
            case 'svNo': return <span className="block text-center">{i + 1}</span>;
            case 'serviceCode': return <span className="font-semibold whitespace-nowrap">{String(row.values.serviceCode ?? '')}</span>;
            case 'serviceVendorId': return <span className="break-words">{nameOf(row)}{!row.meta.selected && <span className="block text-[11px] text-[#b45309]">No longer chosen in Vendor Selection</span>}</span>;
            case 'svDuration': {
              const d = row.calc.svDuration as { planned: number | null; actual: number | null; text: string };
              return d.text ? <span className="whitespace-nowrap font-medium" title="Planned / actual">{d.text}</span> : <span className="text-gray-300">—</span>;
            }
            case 'svGiven': return <span className="block text-right">{moneyCell(row.calc.svGiven)}</span>;
            case 'svBalance': return <span className="block text-right">{moneyCell(row.calc.svBalance, typeof row.calc.svBalance === 'number' && row.calc.svBalance < 0 ? 'text-[#d9232b]' : '')}</span>;
            case 'svPayment': return <div className="flex justify-center"><button type="button" onClick={() => setPaying(row)} disabled={!canEdit || !detail.abilities.pprCreate} title={detail.abilities.pprCreate ? 'Pay this vendor' : 'You may not create pre-payment records'} aria-label={`Pay ${nameOf(row)}`} className={iconButton}><IndianRupee className="h-[18px] w-[18px]" /></button></div>;
            case 'svHistory': return <div className="flex justify-center"><button type="button" onClick={() => setHistory(row)} disabled={!detail.abilities.pprView} title={detail.abilities.pprView ? 'Payment history' : 'You may not view pre-payment records'} aria-label={`Payment history of ${nameOf(row)}`} className={iconButton}><Clock className="h-[18px] w-[18px]" /></button></div>;
            default: return <RowField field={f} row={row} path={`/service-vendors/${row.id}`} />;
          }
        }}
      />
      {paying && (
        <PaymentPopup
          vendorName={nameOf(paying)}
          row={paying}
          templates={detail.refs.templates}
          onClose={() => setPaying(null)}
          send={async body => {
            try { return await call<{ detail: ProjectDetail; code: string }>(`/service-vendors/${paying.id}/payment`, 'POST', body); } catch (e) { fail(e); throw e; }
          }}
        />
      )}
      {history && <HistoryPopup projectId={detail.id} kind="service" row={history} vendorName={nameOf(history)} onClose={() => setHistory(null)} />}
    </Section>
  );
}
