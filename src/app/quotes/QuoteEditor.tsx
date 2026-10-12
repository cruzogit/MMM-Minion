'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { callApi } from '@/lib/leads/client';
import { FRESH, decideResume, type FormBoot, type PendingDraft, type Resume, type ServerDraft } from '@/lib/quotes/resume';
import QuoteForm, { type QuoteFormProps } from './QuoteForm';
import { clearBackup, readBackup } from './useDraftSync';
import { Button, Spinner } from './ui';

const fmt = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Opens the Add / Edit Quote form. A refresh of the same tab goes straight back into the quote in progress; coming back later (another day, another tab, after
// the computer was shut down) asks whether to continue or to leave it. What was typed is never thrown away without that answer.
export default function QuoteEditor(props: QuoteFormProps & { serverDraft: ServerDraft | null; pending: PendingDraft[] }) {
  const { serverDraft, pending, ...formProps } = props;
  const { mode, quote } = formProps;
  const [boot, setBoot] = useState<FormBoot | null>(null);
  const [ask, setAsk] = useState<Resume | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scope = mode === 'edit' ? `edit:${quote?.id}` : serverDraft?.id ?? 'new';

  useEffect(() => {
    // Only the browser knows the copy kept on the device and whether this tab was on the quote before, so the choice is made once the page is up
    const t = setTimeout(() => {
      let sameTab = false;
      try { sameTab = !!quote && window.sessionStorage.getItem(`minion.quote.open:${quote.id}`) === '1'; } catch { /* a convenience */ }
      const r = decideResume({ mode, serverDraft, pending, copy: readBackup(scope), sameTab, now: Date.now(), fmt });
      if (r.dropCopy) clearBackup(scope);
      if (r.kind === 'open') setBoot(r.boot);
      else setAsk(r);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the page mounts this again (new key) when the quote in progress changes
  }, []);

  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await job(); } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong. Try again.'); setBusy(false); }
  };

  if (boot) return <QuoteForm {...formProps} boot={boot} />;

  if (ask?.kind === 'ask-edit') {
    const a = ask;
    return (
      <Dialog
        title="Unsaved changes found"
        error={error}
        body={<p>You have changes on {quote?.quoteNumber ?? 'this quote'}{a.since ? ` from ${a.since}` : ''} that were not saved to the quote. Continue where you left off, or leave them and edit the quote as it was last saved?</p>}
        actions={(
          <>
            <Button kind="blue" onClick={() => { setBoot(a.boot); }} disabled={busy}>Continue Editing</Button>
            <Button kind="ghost" busy={busy} onClick={() => void run(async () => {
              await callApi(`/api/quotes/${quote?.id}/draft`, 'DELETE');
              clearBackup(scope);
              setBoot(FRESH);
            })}>Leave and Discard Changes</Button>
          </>
        )}
      />
    );
  }

  if (ask?.kind === 'ask-new') {
    const p = ask.pending;
    return (
      <Dialog
        title="Continue your unfinished quote?"
        error={error}
        body={(
          <>
            <p>
              <b>{p.number || 'A new quote'}</b>{p.customer ? ` for ${p.customer}` : ''} is still in progress ({p.items} item{p.items === 1 ? '' : 's'}, last saved {fmt(p.updatedAt)}).
            </p>
            <p>Continue it, or discard it and start a new quote? A discarded quote is deleted for good and its number is given back.</p>
          </>
        )}
        actions={(
          <>
            <Button kind="blue" disabled={busy} onClick={() => {
              setBusy(true);
              // a full load of the quote in progress: this screen was opened for "no draft" and is not reused for another one
              window.location.assign(p.href);
            }}>Continue Editing</Button>
            <Button kind="ghost" busy={busy} onClick={() => void run(async () => {
              await callApi(`/api/quotes/drafts/${p.id}`, 'DELETE');
              // a full load: the number it gave back is the next one, and the page asks the server for it again
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign('/quotes/new');
            })}>Leave and Discard Changes</Button>
            <button type="button" disabled={busy} onClick={() => setBoot(FRESH)} className="ml-auto text-[13px] text-[#548df6] hover:underline disabled:opacity-60">Start another, keep that one</button>
          </>
        )}
      />
    );
  }

  return <div className="min-h-screen flex items-center justify-center text-[#6d7189]" role="status" aria-label="Opening the quote"><Spinner className="w-5 h-5" /></div>;
}

function Dialog({ title, body, actions, error }: { title: string; body: React.ReactNode; actions: React.ReactNode; error: string }) {
  return (
    <div className="min-h-screen bg-white">
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(34,38,59,0.45)] p-3">
        <div role="dialog" aria-modal="true" aria-labelledby="resume-title" className="w-full max-w-[500px] bg-white rounded-[8px] shadow-[0_12px_40px_rgba(34,38,59,0.25)] text-[#22263b]">
          <div className="px-[24px] pt-[24px] pb-[20px]">
            <div className="flex items-center gap-[12px] mb-[16px]">
              <div className="text-[#f59e0b]"><AlertTriangle className="w-[28px] h-[28px]" fill="#fde68a" strokeWidth={1.5} /></div>
              <h2 id="resume-title" className="text-[20px] font-medium text-[#22263b]">{title}</h2>
            </div>
            <div className="text-[14px] text-[#333] pl-[4px] space-y-2">{body}</div>
            {error && <p role="alert" className="mt-3 text-[13px] text-[#b42318]">{error}</p>}
          </div>
          <div className="px-[24px] py-[16px] border-t border-[#ebeaf2] flex flex-wrap items-center gap-[12px]">{actions}</div>
        </div>
      </div>
    </div>
  );
}
