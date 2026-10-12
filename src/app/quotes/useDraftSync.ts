'use client';

// Auto-save of the quote form. The form is saved to the database a moment after every change (also a half-typed row), one request at a time, always with
// the newest state; a change made while a request is on its way is sent right after it. What the server has confirmed is remembered; nothing newer is
// ever thrown away. If a request fails the form keeps working, the failure is shown, and the save is tried again (also when the connection is back).
// A copy of the latest state is kept on this device until the server has it, and the tab sends its last changes when it is closed or hidden.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, callApi } from '@/lib/leads/client';
import { hasMeaningfulData, type DraftState } from '@/lib/quotes/draft';

export type SyncStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'failed' | 'conflict' | 'gone';
type Header = { id: string; rev: number; quoteNumber: string | null; updatedAt: string };

const DEBOUNCE_MS = 700; // after the last change
const MAX_WAIT_MS = 4000; // however long someone keeps typing
const RETRY_MS = [2000, 5000, 10000, 20000, 30000];
const KEEPALIVE_MAX = 60_000; // browsers allow about 64 KB for a request that outlives the page
const KEY = 'minion.quoteDraft.v1:';

export type Backup = { at: number; state: DraftState };
export const backupKeyFor = (scope: string) => `${KEY}${scope}`;
export function readBackup(scope: string): Backup | null {
  try {
    const raw = window.localStorage.getItem(backupKeyFor(scope));
    const b = raw ? (JSON.parse(raw) as Backup) : null;
    return b && typeof b.at === 'number' && b.state && b.state.v === 1 ? b : null;
  } catch { return null; }
}
export function clearBackup(scope: string) {
  try { window.localStorage.removeItem(backupKeyFor(scope)); } catch { /* storage is a convenience */ }
}

type Options = {
  mode: 'create' | 'edit';
  quoteId?: string; // edit: the saved quote
  initial: { id: string; rev: number; quoteNumber: string | null } | null; // the draft / working copy that exists already
  read: () => DraftState; // the form as it is now
  onCreated?: (h: Header) => void; // new quote: the first save made the draft
  startDirty?: boolean; // the form starts with something the server does not have (recovered from this device)
};

export type DraftSync = {
  status: SyncStatus;
  savedAt: Date | null;
  error: string;
  draftId: string | null;
  draftIdNow: () => string | null; // the same, read at once (after an await the state above is the old one)
  quoteNumber: string | null;
  hasCopy: boolean; // the server holds a working copy of this form
  touch: () => void; // call after every change of the form
  touchUi: () => void; // the cursor or the scroll position changed: sent with the next save, and when the page is closed
  flush: () => Promise<boolean>; // save everything now; true when the server has the newest state
  retry: () => void;
  keepMine: () => void; // after a conflict: this window's version replaces the server's
  recreate: () => void; // after the copy was deleted elsewhere: save this window's version as a new copy
  discard: () => Promise<void>; // "Leave and Discard Changes": delete the working copy (a new quote also gives its number back)
  stop: () => void; // no more saving
  finish: () => void; // no more saving, and the copy kept on this device is not needed any more (after Save)
};

export default function useDraftSync(opts: Options): DraftSync {
  const [status, setStatus] = useState<SyncStatus>(opts.startDirty ? 'dirty' : 'idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [ids, setIds] = useState<{ id: string | null; number: string | null; copy: boolean }>({ id: opts.initial?.id ?? null, number: opts.initial?.quoteNumber ?? null, copy: !!opts.initial });

  const o = useRef(opts);
  useEffect(() => { o.current = opts; });
  const idRef = useRef<string | null>(opts.initial?.id ?? null);
  const revRef = useRef<number | null>(opts.initial ? opts.initial.rev : null);
  const version = useRef(opts.startDirty ? 1 : 0); // grows with every change
  const saved = useRef(0); // the version the server has confirmed
  const uiDirty = useRef(false);
  const stopped = useRef(false);
  const failed = useRef(false);
  const blocked = useRef<null | 'conflict' | 'gone'>(null);
  const force = useRef(false); // the revision is not known (the page was left with a request on its way): the next save replaces whatever is there
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstChange = useRef(0);
  const failures = useRef(0);
  const draining = useRef<Promise<boolean> | null>(null);
  const drainRef = useRef<() => Promise<boolean>>(async () => false);
  const creating = useRef(false);
  const backupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scope = useCallback(() => (o.current.mode === 'edit' ? `edit:${o.current.quoteId}` : idRef.current ?? 'new'), []);

  const backupNow = useCallback(() => {
    if (stopped.current || version.current <= saved.current) return;
    try { window.localStorage.setItem(backupKeyFor(scope()), JSON.stringify({ at: Date.now(), state: o.current.read() } satisfies Backup)); } catch { /* storage full or blocked */ }
  }, [scope]);

  const writeBackup = useCallback(() => {
    if (backupTimer.current) return;
    backupTimer.current = setTimeout(() => { backupTimer.current = null; backupNow(); }, 250);
  }, [backupNow]);

  const url = () => (o.current.mode === 'edit' ? `/api/quotes/${o.current.quoteId}/draft` : idRef.current ? `/api/quotes/drafts/${idRef.current}` : '/api/quotes/drafts');
  const method = () => (o.current.mode === 'create' && !idRef.current ? 'POST' : 'PUT');
  const bodyOf = (state: DraftState, forced: boolean) =>
    o.current.mode === 'edit' ? { state, rev: revRef.current, force: forced } : idRef.current ? { state, rev: revRef.current ?? 0, force: forced } : { state };

  const apply = useCallback((h: Header) => {
    const wasNew = o.current.mode === 'create' && !idRef.current;
    const oldScope = scope();
    idRef.current = h.id;
    revRef.current = h.rev;
    setIds({ id: h.id, number: h.quoteNumber ?? null, copy: true });
    if (wasNew) {
      clearBackup(oldScope); // the copy kept under "new" now belongs to the draft
      o.current.onCreated?.(h);
    }
  }, [scope]);

  const sendOnce = useCallback(async (state: DraftState) => {
    const creatingNow = o.current.mode === 'create' && !idRef.current;
    if (creatingNow) creating.current = true;
    const forced = force.current;
    try {
      const h = await callApi<Header>(url(), method(), bodyOf(state, forced));
      apply(h);
      if (forced) force.current = false;
    } finally {
      if (creatingNow) creating.current = false;
    }
  }, [apply]);

  const scheduleRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const wait = RETRY_MS[Math.min(failures.current - 1, RETRY_MS.length - 1)];
    retryTimer.current = setTimeout(() => { retryTimer.current = null; void drainRef.current(); }, wait);
  }, []);

  const drain = useCallback((): Promise<boolean> => {
    if (draining.current) return draining.current;
    const run = (async () => {
      try {
        while (!stopped.current && !blocked.current && saved.current < version.current) {
          const v = version.current;
          const state = o.current.read();
          if (o.current.mode === 'create' && !idRef.current && !hasMeaningfulData(state)) { saved.current = v; setStatus('idle'); continue; } // nothing worth a draft yet
          setStatus('saving');
          const creatingPost = o.current.mode === 'create' && !idRef.current;
          try {
            await sendOnce(state);
            saved.current = v;
            uiDirty.current = false;
            failed.current = false;
            failures.current = 0;
            setError('');
            setSavedAt(new Date());
            if (version.current <= v) { setStatus('saved'); clearBackup(scope()); } else setStatus('dirty');
          } catch (e) {
            if (e instanceof ApiError && e.status === 409 && !creatingPost) { blocked.current = 'conflict'; setStatus('conflict'); setError(e.message); return false; }
            if (e instanceof ApiError && e.status === 404) { blocked.current = 'gone'; setStatus('gone'); setError(e.message); return false; }
            failures.current++;
            failed.current = true;
            setStatus('failed');
            setError(e instanceof ApiError && e.status === 401 ? 'You are signed out. Sign in again; your changes are kept on this device.' : e instanceof ApiError ? e.message : 'No connection. Your changes are kept on this device and will be saved when it is back.');
            if (!(e instanceof ApiError && [400, 403, 413].includes(e.status)) && !(e instanceof ApiError && e.status === 409)) scheduleRetry();
            return false;
          }
        }
        return saved.current >= version.current;
      } catch {
        return false; // never an unhandled error from a timer: the state stays "not saved" and the next change or retry tries again
      }
    })();
    draining.current = run;
    // cleared after it is set: a pass that ends without waiting for anything must not leave a finished promise in the slot
    const done = () => { if (draining.current === run) draining.current = null; };
    void run.then(done, done);
    return run;
  }, [sendOnce, scheduleRetry, scope]);
  useEffect(() => { drainRef.current = drain; }, [drain]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!firstChange.current) firstChange.current = Date.now();
    const wait = Math.max(0, Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (Date.now() - firstChange.current)));
    timer.current = setTimeout(() => { timer.current = null; firstChange.current = 0; void drain(); }, wait);
  }, [drain]);

  const touch = useCallback(() => {
    version.current++;
    if (stopped.current) return;
    writeBackup();
    if (blocked.current) return;
    setStatus(s => (s === 'saving' || s === 'failed' ? s : 'dirty'));
    schedule();
  }, [schedule, writeBackup]);

  const touchUi = useCallback(() => { uiDirty.current = true; }, []);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; firstChange.current = 0; }
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    if (blocked.current) return false;
    return drain();
  }, [drain]);

  const retry = useCallback(() => { failures.current = 0; void flush(); }, [flush]);

  const keepMine = useCallback(() => {
    blocked.current = null;
    force.current = true;
    version.current++;
    setError('');
    void flush();
  }, [flush]);

  const recreate = useCallback(() => {
    blocked.current = null;
    force.current = false;
    revRef.current = null;
    if (o.current.mode === 'create') idRef.current = null; // a new quote starts again with a new draft (and a new number)
    setIds(i => ({ ...i, id: o.current.mode === 'create' ? null : i.id, copy: false }));
    version.current++;
    setError('');
    void flush();
  }, [flush]);

  const stop = useCallback(() => {
    stopped.current = true;
    for (const t of [timer, retryTimer, backupTimer]) if (t.current) { clearTimeout(t.current); t.current = null; }
  }, []);

  const finish = useCallback(() => {
    stop();
    clearBackup(scope());
    clearBackup('new');
  }, [scope, stop]);

  const discard = useCallback(async () => {
    stop();
    try {
      // wait for a request that is on its way, so that it cannot create the draft again after it was deleted
      if (draining.current) await draining.current.catch(() => false);
      if (o.current.mode === 'edit') await callApi(`/api/quotes/${o.current.quoteId}/draft`, 'DELETE');
      else if (idRef.current) await callApi(`/api/quotes/drafts/${idRef.current}`, 'DELETE');
    } catch (e) {
      stopped.current = false; // the copy is still there: the form goes on saving into it
      if (saved.current < version.current) schedule();
      throw e;
    }
    clearBackup(scope());
    clearBackup('new');
  }, [scope, stop, schedule]);

  // A form recovered from this device has something to send at once
  useEffect(() => {
    if (opts.startDirty) { writeBackup(); schedule(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only at the start
  }, []);

  // The page is closed, or the form is left through a link of the app: what is not on the server yet is sent in a request the browser finishes by itself
  const leaving = useCallback(() => {
    if (stopped.current || blocked.current) return;
    const copyExists = o.current.mode === 'edit' ? revRef.current !== null : idRef.current !== null;
    if (saved.current >= version.current && !(uiDirty.current && copyExists)) return; // a moved cursor alone is not worth a new copy
    backupNow();
    if (creating.current) return; // the request that makes the draft is on its way
    try {
      const state = o.current.read();
      if (o.current.mode === 'create' && !idRef.current && !hasMeaningfulData(state)) return;
      // keepalive: the browser finishes the request after the page is gone. The newest state wins (force): this window is going away,
      // and the revision the server will have afterwards is not known here.
      const body = JSON.stringify(bodyOf(state, true));
      if (body.length > KEEPALIVE_MAX) return; // too big to send that way: the copy on this device is used on the next visit
      force.current = true;
      void fetch(url(), { method: method(), headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
    } catch { /* the copy on this device is still there */ }
  }, [backupNow]);

  // The page being hidden or closed
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState !== 'hidden' || stopped.current || blocked.current) return;
      if (saved.current >= version.current) return;
      backupNow();
      void flush(); // the tab is still alive: the normal save
    };
    const back = () => { if (failed.current) { failures.current = 0; void flush(); } };
    const warn = (e: BeforeUnloadEvent) => {
      if (!stopped.current && saved.current < version.current && blocked.current === null && failed.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('online', back);
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('pagehide', leaving);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('online', back);
      window.removeEventListener('beforeunload', warn);
    };
  }, [flush, backupNow, leaving]);

  // Leaving through a link of the app: send what is not saved yet and stop. Mounting switches saving on again, because React (in development) mounts, unmounts and
  // mounts a component once more to find mistakes, and the form must still save after that.
  const unmounting = useRef(false);
  useEffect(() => {
    stopped.current = false;
    unmounting.current = false;
    return () => {
      unmounting.current = true;
      // a moment later: in development React mounts the form again at once (then nothing is left or stopped), a real unmount stays unmounted
      setTimeout(() => { if (unmounting.current) { leaving(); stop(); } }, 0);
    };
  }, [leaving, stop]);

  return { status, savedAt, error, draftId: ids.id, draftIdNow: () => idRef.current, quoteNumber: ids.number, hasCopy: ids.copy, touch, touchUi, flush, retry, keepMine, recreate, discard, stop, finish };
}
