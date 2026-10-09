'use client';

import type { LayoutSection } from '@/lib/records/types';
import { buildColumns, materialStatusTone, moneyCell, RowField, Section, SectionTable, useProject } from './common';

// MATERIAL VENDOR INVOLVEMENT: a row for every Material Vendor chosen in Vendor Selection, with a code that never changes (MP1M1, MP1M2 ...).
// Given Amount is what the Pre-Payment Records of this deal say was paid to the vendor; Balance = Quoted Value - Given Amount;
// Credit Value = what was given beyond the Quoted Value.
export default function MaterialVendorSection({ section }: { section: LayoutSection }) {
  const { detail, layout } = useProject();
  const columns = buildColumns(layout, section.id, [['planningToTake', 'takenDate']]);

  return (
    <Section id={section.id} title={section.label}>
      <SectionTable
        columns={columns}
        rows={detail.materialVendors}
        empty="Choose Material Vendors in Vendor Selection and they appear here."
        rowClass={row => (row.meta.selected ? '' : 'bg-gray-50 text-gray-500')}
        cell={(f, row, i) => {
          switch (f.key) {
            case 'mvNo': return <span className="block text-center">{i + 1}</span>;
            case 'materialCode': return <span className="font-semibold whitespace-nowrap">{String(row.values.materialCode ?? '')}</span>;
            case 'materialVendorId': {
              const v = detail.refs.materialVendors[String(row.meta.vendorId)];
              return <span className="break-words">{v ? `${v.code} - ${v.name}` : String(row.meta.vendorId)}{!row.meta.selected && <span className="block text-[11px] text-[#b45309]">No longer chosen in Vendor Selection</span>}</span>;
            }
            case 'materialStatus': return <RowField field={f} row={row} path={`/material-vendors/${row.id}`} badge={materialStatusTone} />;
            case 'mvGiven': return <span className="block text-right">{moneyCell(row.calc.mvGiven)}</span>;
            case 'mvBalance': return <span className="block text-right">{moneyCell(row.calc.mvBalance, typeof row.calc.mvBalance === 'number' && row.calc.mvBalance < 0 ? 'text-[#d9232b]' : '')}</span>;
            case 'mvCredit': return <span className="block text-right">{typeof row.calc.mvCredit === 'number' && row.calc.mvCredit > 0 ? moneyCell(row.calc.mvCredit, 'text-[#d9232b]') : <span className="text-gray-300">—</span>}</span>;
            default: return <RowField field={f} row={row} path={`/material-vendors/${row.id}`} />;
          }
        }}
      />
    </Section>
  );
}
