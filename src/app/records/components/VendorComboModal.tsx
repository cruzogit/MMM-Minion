'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { LookupItem } from '@/lib/records/types';
import { searchLookup } from '../client';

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (serviceVendorId: string, materialVendorId: string, serviceVendorName: string, materialVendorName: string) => void;
  initialServiceId: string;
  initialMaterialId: string;
  // The names the form already shows for the two ids, so saving without touching a vendor keeps its name
  initialServiceLabel?: string;
  initialMaterialLabel?: string;
  slug: string; // prePayment
};

type Picked = { id: string; label: string } | null;
const vendorLabel = (v: LookupItem) => (v.sub ? `${v.label} - ${v.sub.split(' · ')[0]}` : v.label);

// The dialog is mounted each time it opens, so it always starts from what the form holds now
// (a vendor cleared outside must not come back) without any effect to copy the props into state.
export function VendorComboModal({ open, ...props }: Props) {
  return open ? <VendorComboDialog {...props} /> : null;
}

function VendorComboDialog({ onClose, onSave, initialServiceId, initialMaterialId, initialServiceLabel, initialMaterialLabel, slug }: Omit<Props, 'open'>) {
  const [tab, setTab] = useState<'service' | 'material'>('service');
  const [q, setQ] = useState('');
  const [serviceVendors, setServiceVendors] = useState<LookupItem[]>([]);
  const [materialVendors, setMaterialVendors] = useState<LookupItem[]>([]);
  const [selService, setSelService] = useState<Picked>(initialServiceId ? { id: initialServiceId, label: initialServiceLabel || 'Selected' } : null);
  const [selMaterial, setSelMaterial] = useState<Picked>(initialMaterialId ? { id: initialMaterialId, label: initialMaterialLabel || 'Selected' } : null);

  // The list of the active tab: loads on open and follows the search box (a short wait between key strokes)
  useEffect(() => {
    let stale = false;
    const t = setTimeout(() => {
      searchLookup(slug, tab === 'service' ? 'serviceVendors' : 'materialVendors', q).then(res => {
        if (stale) return;
        if (tab === 'service') setServiceVendors(res);
        else setMaterialVendors(res);
      }).catch(() => {});
    }, q ? 300 : 0);
    return () => { stale = true; clearTimeout(t); };
  }, [q, tab, slug]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const list = tab === 'service' ? serviceVendors : materialVendors;
  const selected = tab === 'service' ? selService : selMaterial;
  const setSelected = tab === 'service' ? setSelService : setSelMaterial;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(34,38,59,0.45)] p-3">
      <div role="dialog" aria-modal="true" className="w-full max-w-[600px] bg-white rounded-[8px] shadow-[0_12px_40px_rgba(34,38,59,0.25)] flex flex-col max-h-[85vh]">
        <div className="px-6 py-5 border-b border-[#ebeaf2] shrink-0 flex items-start justify-between">
          <h2 className="text-[20px] font-bold text-[#22263b] leading-tight mb-1">Select Vendors</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-[#a0a4b8] hover:text-[#e5484d] transition-colors"><X className="w-6 h-6" /></button>
        </div>

        <div className="px-6 pt-2 shrink-0 border-b border-[#ebeaf2] flex gap-6 text-[14px] font-medium text-[#7f8497]">
          <button type="button" className={`pb-3 border-b-2 transition-colors ${tab === 'service' ? 'border-[#548df6] text-[#22263b]' : 'border-transparent hover:text-[#22263b]'}`} onClick={() => { setTab('service'); setQ(''); }}>Service Vendor</button>
          <button type="button" className={`pb-3 border-b-2 transition-colors ${tab === 'material' ? 'border-[#548df6] text-[#22263b]' : 'border-transparent hover:text-[#22263b]'}`} onClick={() => { setTab('material'); setQ(''); }}>Material Vendor</button>
        </div>

        <div className="p-6 flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="relative mb-4 shrink-0">
            <Search className="w-4 h-4 absolute left-3 top-[11px] text-[#9ca0ab]" />
            <input
              type="text"
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`Search ${tab === 'service' ? 'service' : 'material'} vendors...`}
              className="w-full h-[38px] pl-9 pr-3 rounded-[6px] border border-[#d7d5e1] focus:border-[#548df6] focus:outline-none text-[14px]"
            />
          </div>

          <div className="flex-1 overflow-y-auto border border-[#ebeaf2] rounded-[6px]">
            {list.map(v => (
              <label key={v.id} className="flex items-start gap-3 p-3 border-b border-[#ebeaf2] last:border-0 hover:bg-[#f9f9fb] cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected?.id === v.id}
                  onChange={e => setSelected(e.target.checked ? { id: v.id, label: vendorLabel(v) } : null)}
                  className="mt-1 w-[16px] h-[16px] rounded border-[#c9cbd6] text-[#548df6] focus:ring-[#548df6]"
                />
                <div>
                  <div className="text-[14px] font-medium text-[#22263b]">{v.label}</div>
                  {v.sub && <div className="text-[12px] text-[#7f8497] mt-0.5">{v.sub}</div>}
                </div>
              </label>
            ))}
            {list.length === 0 && <div className="p-4 text-center text-[13px] text-[#7f8497]">No vendors found.</div>}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#ebeaf2] flex items-center justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="h-[36px] px-4 rounded-[6px] border border-[#d7d5e1] text-[#22263b] font-medium text-[14px] hover:bg-[#f1f1fa]">Cancel</button>
          <button type="button" onClick={() => onSave(selService?.id ?? '', selMaterial?.id ?? '', selService?.label ?? '', selMaterial?.label ?? '')} className="h-[36px] px-6 rounded-[6px] bg-[#f59e0b] hover:bg-[#d97706] text-white font-medium text-[14px]">Save</button>
        </div>
      </div>
    </div>
  );
}
