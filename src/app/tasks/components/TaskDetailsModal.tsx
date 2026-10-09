'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { FileText, Loader2, Music, Pencil, Trash2, Upload, X } from 'lucide-react';
import { callApi, uploadToSignedUrl } from '@/lib/leads/client';
import { useToast } from '@/components/ui/Toast';
import type { TaskDetail } from '@/lib/tasks/types';
import QueueList from '@/app/leads/components/QueueList';
import LightConfirm from '@/app/leads/components/LightConfirm';
import { useFileQueue } from '@/app/leads/components/useFileQueue';
import { remainingClass, StatusBadge, TypeTag } from './badges';

const mb = (n: number | null) => (n === null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</dt><dd className="text-[14px] text-gray-900 mt-0.5 break-words whitespace-pre-line">{children || '—'}</dd></div>;
}

export default function TaskDetailsModal({ taskId, focus, onClose, onEdit, onChanged }: {
  taskId: string;
  focus?: 'files';
  onClose: () => void;
  onEdit: (t: TaskDetail) => void;
  onChanged: () => void; // the table behind should reload (files added or removed)
}) {
  const toast = useToast();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const filesRef = useRef<HTMLDivElement>(null);
  const queue = useFileQueue({ max: 10, onProblem: m => toast.error(m) });

  const load = () => callApi<{ task: TaskDetail }>(`/api/tasks/${taskId}`, 'GET').then(d => setTask(d.task)).catch(e => setError(e.message));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  useEffect(() => { if (task && focus === 'files') filesRef.current?.scrollIntoView({ block: 'start' }); }, [task, focus]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !removing && !uploading && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose, removing, uploading]);

  const upload = async () => {
    const ready = queue.items.filter(i => i.status === 'ready' && i.blob);
    if (!ready.length) return;
    setUploading(true);
    try {
      const { uploads } = await callApi<{ uploads: { index: number; path: string; uploadUrl: string }[] }>(`/api/tasks/${taskId}/files`, 'POST', {
        files: ready.map(i => ({ name: i.name, type: i.type, size: i.size })),
      });
      for (const u of uploads) {
        const item = ready[u.index];
        queue.patch(item.key, { status: 'uploading' });
        try { await uploadToSignedUrl(u.uploadUrl, item.blob!); } catch { queue.patch(item.key, { status: 'error', error: 'Upload failed' }); throw new Error(`Upload of ${item.name} failed`); }
      }
      const done = await callApi<{ saved: string[]; problems: string[] }>(`/api/tasks/${taskId}/files`, 'PUT', {
        files: uploads.map(u => ({ path: u.path, name: ready[u.index].name, type: ready[u.index].type, size: ready[u.index].size })),
      });
      for (const u of uploads) queue.patch(ready[u.index].key, { status: done.saved.includes(ready[u.index].name) ? 'uploaded' : 'error', error: done.problems.find(p => p.startsWith(ready[u.index].name)) });
      if (done.problems.length) toast.error(done.problems[0]);
      if (done.saved.length) { toast.success(done.saved.length === 1 ? 'File uploaded' : `${done.saved.length} files uploaded`); onChanged(); await load(); }
      setTimeout(() => queue.clear(), 900);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not upload the files');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = async () => {
    if (!removing) return;
    try { await callApi(`/api/tasks/${taskId}/files/${removing.id}`, 'DELETE'); toast.success('File removed'); onChanged(); await load(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove the file'); }
    finally { setRemoving(null); }
  };

  const t = task;
  const hasReady = queue.items.some(i => i.status === 'ready');
  return (
    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center bg-black/50 p-0 sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget && !uploading) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="task-details-title" className="bg-white w-full sm:max-w-[760px] max-h-screen sm:max-h-[92vh] sm:rounded-lg shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 id="task-details-title" className="text-[19px] font-bold text-[#333] break-words">{t?.title ?? 'Task'}</h2>
            {t && <div className="mt-1.5 flex items-center gap-2"><TypeTag type={t.taskType} label={t.typeLabel} /><StatusBadge status={t.status} /></div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-500 hover:text-black shrink-0"><X className="w-6 h-6" /></button>
        </div>

        <div className="overflow-y-auto px-6 py-5 space-y-6">
          {!t && !error && <div className="py-12 flex justify-center text-gray-500"><Loader2 className="w-6 h-6 animate-spin" /></div>}
          {error && <p role="alert" className="text-[#d9232b] text-[14px]">{error}</p>}
          {t && (
            <>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <Item label="Assigned D&T">{`${t.assigned.date} ${t.assigned.time}`}</Item>
                <Item label="Start Date">{t.start ? `${t.start.date} ${t.start.time}` : null}</Item>
                <Item label="Task person">{t.assignee?.name}</Item>
                <Item label="Assigned by">{t.assignedBy?.name}</Item>
                <Item label="Task Due D&T">{t.due ? <>{`${t.due.date} ${t.due.time}`}<span className={`ml-2 text-[12px] ${remainingClass(t.remaining)}`}>{t.remaining}</span></> : null}</Item>
                <Item label="Completed">{t.completed ? `${t.completed.date} ${t.completed.time}` : null}</Item>
                <Item label="Lead ID">{t.lead ? <Link href={`/leads?view=${t.lead.id}`} className="text-[#2f80ed] font-semibold hover:underline">{t.lead.code}</Link> : null}</Item>
                <Item label="Linked to">{t.link ? `${t.link.kind[0].toUpperCase()}${t.link.kind.slice(1)}: ${t.link.label}` : null}</Item>
                <Item label="Priority">{t.priority}</Item>
                <Item label="Proof file">{t.requiresCompletionProof ? 'Required before completing' : 'Not required'}</Item>
                {t.customFields.map(f => <Item key={f.key} label={f.label}>{f.value}</Item>)}
                {t.notes.customerName && <div className="sm:col-span-2"><Item label="Customer">{`${t.notes.customerName}${t.notes.contactNumber ? ` (${t.notes.contactNumber})` : ''}`}</Item></div>}
                {t.notes.requirement && <div className="sm:col-span-2"><Item label="Lead requirement">{t.notes.requirement}</Item></div>}
                <div className="sm:col-span-2"><Item label="Notes">{t.notes.text}</Item></div>
              </dl>

              <div ref={filesRef}>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Files ({t.files.length})</div>
                {t.files.length === 0 ? <p className="text-[13px] text-gray-500">No files uploaded yet.</p> : (
                  <ul className="space-y-2">
                    {t.files.map(f => {
                      const audio = !!f.mimeType?.startsWith('audio/');
                      return (
                        <li key={f.id} className="flex items-center gap-3 border border-gray-200 rounded-md px-3 py-2">
                          {audio ? <Music className="w-5 h-5 text-[#d9232b] shrink-0" /> : <FileText className="w-5 h-5 text-gray-400 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            {f.url ? <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-[13px] text-[#2f80ed] hover:underline break-all">{f.name}</a> : <span className="text-[13px] text-gray-500 break-all">{f.name} (link unavailable)</span>}
                            <div className="text-[11px] text-gray-500">{mb(f.size)}</div>
                            {audio && f.url && <audio controls preload="none" src={f.url} aria-label={`Play ${f.name}`} className="mt-1 h-9 w-full max-w-[320px]" />}
                          </div>
                          {t.can.upload && <button type="button" onClick={() => setRemoving({ id: f.id, name: f.name })} aria-label={`Remove ${f.name}`} title="Remove file" className="text-gray-500 hover:text-[#d9232b] shrink-0"><Trash2 className="w-4 h-4" /></button>}
                        </li>
                      );
                    })}
                  </ul>
                )}

                {t.can.upload && (
                  <div className="mt-3 space-y-2">
                    <input type="file" multiple disabled={uploading} aria-label="Choose files to upload" onChange={e => { queue.add(Array.from(e.target.files ?? [])); e.target.value = ''; }}
                      className="w-full border-2 border-dashed border-gray-300 rounded-xl p-2 text-[14px]" />
                    <p className="text-[12px] text-gray-500">Photos are resized and compressed automatically. Other files up to 1 MB; audio recordings up to 5 MB.</p>
                    <QueueList items={queue.items} onRemove={queue.remove} disabled={uploading} />
                    {queue.items.length > 0 && (
                      <button type="button" onClick={upload} disabled={uploading || queue.processing || !hasReady}
                        className="inline-flex items-center gap-2 px-4 h-[38px] rounded-lg bg-[#4caf50] hover:bg-[#43a047] text-white text-[14px] font-semibold disabled:opacity-60">
                        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}Upload
                      </button>
                    )}
                  </div>
                )}
              </div>

              {t.history.length > 0 && (
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">History</div>
                  <ul className="space-y-1 text-[12px] text-gray-600">
                    {t.history.map((h, i) => <li key={i}><span className="font-semibold text-gray-800">{h.action.replace(/_/g, ' ').toLowerCase()}</span> · {h.by} · {h.at}</li>)}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 shrink-0">
          {t?.can.edit && <button type="button" onClick={() => onEdit(t)} className="inline-flex items-center gap-2 px-4 h-[38px] rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 text-[14px] font-medium"><Pencil className="w-4 h-4" />Edit Task</button>}
          <button type="button" onClick={onClose} disabled={uploading} className="px-5 h-[38px] rounded-lg bg-[#f5b800] hover:bg-[#e0a800] text-[#1f1f1f] text-[14px] font-semibold disabled:opacity-60">Close</button>
        </div>
      </div>
      {removing && <LightConfirm title="Remove this file?" confirmLabel="Remove" danger onConfirm={removeFile} onCancel={() => setRemoving(null)}>{removing.name} will be deleted from this task.</LightConfirm>}
    </div>
  );
}
