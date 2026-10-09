'use client';

import { useRef, useState } from 'react';
import { Camera, Loader2, Upload, X } from 'lucide-react';
import { AUDIO_ACCEPT, AUDIO_FORMATS_LABEL, MAX_AUDIO_MB } from '@/lib/leads/audio-types';
import { ATTACHMENT_BLOCKED_HINT, FOLLOWUP_NOTES_MAX, MAX_ATTACHMENT_MB, MAX_FOLLOWUP_FILES } from '@/lib/leads/constants';
import { callApi } from '@/lib/leads/client';
import type { LeadRow } from '@/lib/leads/queries';
import { useToast } from '@/components/ui/Toast';
import QueueList from './QueueList';
import { putQueued, toUploadFile, useFileQueue, type SignedUpload, type SkippedFile } from './useFileQueue';

const field = 'w-full border border-gray-300 rounded-lg px-3 h-[42px] text-[14px] text-gray-900 bg-white focus:outline-none focus:border-[#f5b800]';

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type FollowUpSaved = { count: number; last: { date: string; time: string }; next: { date: string; time: string } | null };

// "Upload Follow-up Proof": opened from the green arrow in the Follow-up column. The Deals page uses it too (apiBase '/api/deals', noun 'Deal').
export default function FollowUpModal({ row, onClose, onSaved, apiBase = '/api/leads', noun = 'Lead' }: { row: LeadRow; onClose: () => void; onSaved: (result: FollowUpSaved) => void; apiBase?: string; noun?: string }) {
  const toast = useToast();
  // Photos are resized and compressed here, in the browser, as soon as they are picked
  const queue = useFileQueue({ max: MAX_FOLLOWUP_FILES, onProblem: m => toast.error(m) });
  const [nextDate, setNextDate] = useState(tomorrow());
  const [nextTime, setNextTime] = useState('18:00');
  const [notes, setNotes] = useState('');
  const [taskName, setTaskName] = useState('');
  const [errors, setErrors] = useState<{ files?: string; notes?: string; form?: string }>({});
  const [busy, setBusy] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const saving = !!busy;
  const isAudio = (i: { kind?: string; audio?: boolean }) => i.kind === 'audio' || !!i.audio;

  const add = (incoming: File[]) => {
    setErrors(e => ({ ...e, files: undefined }));
    queue.add(incoming);
    if (input.current) input.current.value = '';
  };

  const addAudio = (incoming: File[]) => {
    queue.add(incoming, { audio: true });
    if (audioInput.current) audioInput.current.value = '';
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next: typeof errors = {};
    if (!queue.items.some(i => !isAudio(i))) next.files = 'Select at least one file';
    else if (queue.processing) next.files = 'Images are still being processed. Please wait a moment.';
    else if (queue.hasErrors) next.files = 'Remove the files marked in red, then try again.';
    if (!notes.trim()) next.notes = 'Follow-up notes are required';
    setErrors(next);
    if (next.files || next.notes) return;
    const sent = queue.items.filter(i => i.status === 'ready');
    try {
      setBusy('Saving…');
      const { followUpId, uploads, skipped } = await callApi<{ followUpId: string; uploads: SignedUpload[]; skipped: SkippedFile[] }>(`${apiBase}/${row.id}/follow-ups`, 'POST', {
        notes: notes.trim(),
        nextDate: nextDate || null,
        nextTime: nextDate ? nextTime || null : null,
        taskName: taskName.trim() || undefined,
        files: sent.map(toUploadFile),
      });
      for (const s of skipped) toast.info(`${s.name} was added twice, so it was only attached once`);
      setBusy('Uploading files…');
      await putQueued(sent, uploads, queue.patch);
      setBusy('Checking files…');
      const saved = await callApi<FollowUpSaved>(`${apiBase}/${row.id}/follow-ups`, 'PUT', { followUpId });
      for (const u of uploads) queue.patch(sent[u.index].key, { status: 'uploaded' });
      await new Promise(resolve => setTimeout(resolve, 700)); // let the ✓ Uploaded state be seen before the dialog closes
      onSaved(saved);
    } catch (err) {
      setErrors({ form: err instanceof Error ? err.message : 'Could not save the follow-up' });
      setBusy('');
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <form role="dialog" aria-modal="true" aria-labelledby="fu-title" onSubmit={submit} noValidate onKeyDown={e => { if (e.key === 'Escape' && !saving) onClose(); }}
        className="bg-white w-full sm:max-w-[560px] max-h-screen sm:max-h-[94vh] overflow-y-auto sm:rounded-xl shadow-2xl px-6 py-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 text-center">
            <h2 id="fu-title" className="inline-flex items-center gap-2.5 text-[22px] font-bold text-[#333]"><Camera className="w-6 h-6 text-[#43a047]" fill="currentColor" stroke="white" />Upload Follow-up Proof</h2>
            <p className="text-[14px] text-gray-500 mt-2">Upload one or more files as proof for this follow-up (images, PDF, Excel, CSV, Word, or any other file)</p>
            <p className="text-[12px] text-gray-400 mt-1">{noun} {row.code} · {row.customerName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Close" className="text-gray-500 hover:text-black disabled:opacity-40"><X className="w-6 h-6" /></button>
        </div>

        <div className="mt-6 space-y-5">
          <div>
            <label htmlFor="fu-files" className="block text-[15px] font-semibold text-[#333] mb-1.5">Select Files <span className="text-[#d9232b]">*</span></label>
            <input ref={input} id="fu-files" type="file" multiple disabled={saving} onChange={e => add(Array.from(e.target.files ?? []))}
              className={`w-full border-2 border-dashed rounded-xl p-2 text-[14px] ${errors.files ? 'border-[#d9232b]' : 'border-gray-300'}`} />
            <p className="text-[12px] text-gray-500 mt-1.5">You can select multiple files of any type, up to {MAX_ATTACHMENT_MB} MB each. Photos (JPEG, PNG, WebP) are resized and compressed to fit. Select again to add more. Not accepted: {ATTACHMENT_BLOCKED_HINT}.</p>
            {errors.files && <p role="alert" className="text-[12px] text-[#d9232b] mt-1">{errors.files}</p>}
            <QueueList items={queue.items.filter(i => !isAudio(i))} onRemove={queue.remove} disabled={saving} className="mt-2 !grid-cols-1" />
          </div>

          <div>
            <label htmlFor="fu-audio" className="block text-[15px] font-semibold text-[#333] mb-1.5">Upload Audio File</label>
            <input ref={audioInput} id="fu-audio" type="file" multiple accept={AUDIO_ACCEPT} disabled={saving} onChange={e => addAudio(Array.from(e.target.files ?? []))}
              className="w-full border-2 border-dashed border-gray-300 rounded-xl p-2 text-[14px]" />
            <p className="text-[12px] text-gray-500 mt-1.5">Optional, for example a call recording. {AUDIO_FORMATS_LABEL}, up to {MAX_AUDIO_MB} MB each. Audio is saved as it is, and can be played from Follow-up Files.</p>
            <QueueList items={queue.items.filter(isAudio)} onRemove={queue.remove} disabled={saving} className="mt-2 !grid-cols-1" />
          </div>

          <div>
            <label htmlFor="fu-date" className="block text-[15px] font-semibold text-[#333] mb-1.5">Next Follow-up Date</label>
            <input id="fu-date" type="date" value={nextDate} onChange={e => setNextDate(e.target.value)} disabled={saving} className={field} />
          </div>
          <div>
            <label htmlFor="fu-time" className="block text-[15px] font-semibold text-[#333] mb-1.5">Next Follow-up Time</label>
            <input id="fu-time" type="time" value={nextTime} onChange={e => setNextTime(e.target.value)} disabled={saving || !nextDate} className={`${field} disabled:bg-gray-50`} />
          </div>
          <div>
            <label htmlFor="fu-notes" className="block text-[15px] font-semibold text-[#333] mb-1.5">Follow-up Notes <span className="text-[#d9232b]">*</span></label>
            <textarea id="fu-notes" rows={4} maxLength={FOLLOWUP_NOTES_MAX} value={notes} onChange={e => { setNotes(e.target.value); if (errors.notes) setErrors(x => ({ ...x, notes: undefined })); }} disabled={saving}
              placeholder="Add any notes about this follow-up..." aria-invalid={errors.notes ? true : undefined}
              className={`w-full border rounded-lg px-3 py-2 text-[14px] text-gray-900 focus:outline-none focus:border-[#f5b800] ${errors.notes ? 'border-[#d9232b]' : 'border-gray-300'}`} />
            {errors.notes && <p role="alert" className="text-[12px] text-[#d9232b] mt-1">{errors.notes}</p>}
          </div>
        </div>

        {errors.form && <p role="alert" className="mt-4 text-[13px] text-[#d9232b]">{errors.form}</p>}
        <div className="mt-6 flex items-center justify-end gap-3">
          {saving && <span className="mr-auto text-[13px] text-gray-500 flex items-center gap-1.5"><Loader2 className="w-4 h-4 animate-spin" />{busy}</span>}
          <button type="button" onClick={onClose} disabled={saving} className="px-5 h-[42px] rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-[14px] font-medium disabled:opacity-60">Cancel</button>
          <button type="submit" disabled={saving || queue.processing || queue.hasErrors} className="inline-flex items-center gap-2 px-5 h-[42px] rounded-lg bg-[#4caf50] hover:bg-[#43a047] text-white text-[14px] font-semibold disabled:opacity-60"><Upload className="w-4 h-4" />Upload &amp; Increment</button>
        </div>
      </form>
    </div>
  );
}
