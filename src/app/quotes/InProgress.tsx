'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FilePen } from 'lucide-react';
import { callApi } from '@/lib/leads/client';
import type { DraftListItem } from '@/lib/quotes/draft-server';
import { clearBackup } from './useDraftSync';
import { Button } from './ui';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Quotes the person started and did not save (the page was closed, the computer was shut down ...), and changes to saved quotes that were not saved. Each can
// be taken up again or discarded; a discarded new quote is deleted for good and gives its number back.
export default function InProgress({ drafts }: { drafts: DraftListItem[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const discard = async (d: DraftListItem) => {
    setBusy(d.id);
    setError('');
    try {
      await callApi(d.kind === 'edit' ? `/api/quotes/${d.quoteId}/draft` : `/api/quotes/drafts/${d.id}`, 'DELETE');
      clearBackup(d.kind === 'edit' ? `edit:${d.quoteId}` : d.id);
      setAsking(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard it. Try again.');
    } finally {
      setBusy(null);
    }
  };

  if (!drafts.length) return null;
  return (
    <section aria-label="Quotes in progress" data-in-progress className="mx-[25px] mb-3 rounded-[6px] border border-[#f2d9a6] bg-[#fff8e6] text-[13px] text-[#4a3a12]">
      <h2 className="flex items-center gap-2 px-3 pt-2 pb-1 font-semibold"><FilePen className="w-4 h-4" aria-hidden /> Quotes in progress ({drafts.length})</h2>
      <ul>
        {drafts.map(d => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 border-t border-[#f2e5c2]">
            <span className="font-medium min-w-[110px]">{d.number || 'New quote'}</span>
            <span className="text-[#6d5a1f]">{d.kind === 'edit' ? 'unsaved changes' : 'not saved yet'}</span>
            <span className="flex-1 min-w-[160px] truncate">{[d.customer, d.subject, `${d.items} item${d.items === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</span>
            <span className="text-[12px] text-[#6d5a1f]">{fmt(d.updatedAt)}</span>
            {asking === d.id ? (
              <span className="flex items-center gap-2">
                <span>{d.kind === 'edit' ? 'Throw these changes away?' : 'Delete it and give its number back?'}</span>
                <Button kind="danger" busy={busy === d.id} onClick={() => void discard(d)}>Yes, Discard</Button>
                <Button kind="ghost" disabled={busy === d.id} onClick={() => setAsking(null)}>Keep</Button>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <Link href={d.href} className="inline-flex items-center h-[28px] px-[10px] rounded-[4px] bg-[#548df6] hover:bg-[#4a82ea] text-white text-[12.5px] font-medium">Continue</Link>
                <Button kind="ghost" onClick={() => { setError(''); setAsking(d.id); }}>Discard</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="px-3 py-1.5 border-t border-[#f2e5c2] text-[#b42318]">{error}</p>}
    </section>
  );
}
