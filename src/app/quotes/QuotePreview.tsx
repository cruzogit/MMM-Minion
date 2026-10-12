'use client';

import { useDeferredValue, useMemo } from 'react';
import { Eye, X } from 'lucide-react';
import { buildDoc } from '@/lib/quotes/doc';
import type { ModuleLayoutDto } from '@/lib/records/types';
import type { QuoteDto, QuoteSettings } from '@/lib/quotes/types';
import QuoteDocument from './QuoteDocument';
import FitWidth from './FitWidth';

// The live preview beside the Add / Edit Quote form: the quote document in its real layout (the one of the Quote Details page and the PDF), drawn from the
// form as it is now. Typing stays smooth because the page is drawn from a slightly older copy while keys are still coming in.
export default function QuotePreview({ quote, layout, settings, images, onClose }: {
  quote: QuoteDto;
  layout: ModuleLayoutDto;
  settings: QuoteSettings;
  images: { logo: string | null; signature: string | null };
  onClose: () => void;
}) {
  const shown = useDeferredValue(quote);
  const doc = useMemo(() => {
    try { return buildDoc(shown, layout, settings, images); } catch { return null; }
  }, [shown, layout, settings, images]);

  return (
    <aside
      aria-label="Live quote preview"
      className="fixed inset-0 z-40 flex flex-col bg-[#eef0f6] lg:inset-auto lg:z-auto lg:w-[48%] lg:max-w-[880px] lg:shrink-0 lg:self-start lg:sticky lg:top-0 lg:h-screen lg:border-l lg:border-[#e0e1ea]"
    >
      <div className="h-[44px] shrink-0 flex items-center gap-2 px-3 bg-white border-b border-[#eeeeee]">
        <Eye className="w-4 h-4 text-[#548df6]" aria-hidden />
        <span className="text-[14px] font-medium text-[#22263b]">Live preview</span>
        <span className="text-[12px] text-[#6d7189]">updates as you type</span>
        <button type="button" onClick={onClose} aria-label="Close the preview" className="ml-auto text-[#6d7189] hover:bg-[#f1f1fa] rounded p-1"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        {doc ? (
          <FitWidth width={796}>
            <div data-quote-preview className="relative border border-[#e0e1ea] bg-white w-[794px]"><QuoteDocument doc={doc} /></div>
          </FitWidth>
        ) : (
          <p className="text-[13px] text-[#6d7189] p-4">The preview cannot be drawn for what is typed right now. It comes back as soon as the values are valid.</p>
        )}
      </div>
    </aside>
  );
}
