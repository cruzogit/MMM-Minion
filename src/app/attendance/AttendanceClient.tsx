'use client';

import { useRef, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { ApiError, callApi } from '@/lib/leads/client';
import { monthOf, shiftMonth, weekStartOf } from '@/lib/attendance/time';
import type { AttendanceAction, Overview, Purpose } from '@/lib/attendance/types';
import ActionDialog from './ActionDialog';
import CheckInCameraModal, { type VerificationResult } from './CheckInCameraModal';
import CalendarCard from './CalendarCard';
import DayPanel from './DayPanel';
import RequestApprovalsCard from './RequestApprovalsCard';
import SummaryCard from './SummaryCard';
import WorkingHoursCard from './WorkingHoursCard';

// The Attendance page of the signed-in person: calendar and summary on the left, the selected day (with the buttons for today) on the right
export default function AttendanceClient({ initial, canMark }: { initial: Overview; canMark: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Overview>(initial);
  const [month, setMonth] = useState(initial.month); // the month the header shows; the calendar follows when its data arrives
  const [selected, setSelected] = useState(initial.defaultDay);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(initial.defaultDay));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AttendanceAction | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const latest = useRef(0); // only the newest request may change the screen

  function show(next: Overview, day: string) {
    setData(next);
    setMonth(next.month);
    setSelected(day);
    setWeekStart(weekStartOf(day));
  }

  async function openMonth(target: string) {
    const id = ++latest.current;
    setMonth(target);
    setLoading(true);
    setError(null);
    try {
      const next = await callApi<Overview>(`/api/attendance?month=${target}`, 'GET');
      if (id === latest.current) show(next, next.defaultDay);
    } catch (e) {
      if (id !== latest.current) return;
      setMonth(data.month);
      setError(e instanceof Error ? e.message : 'Could not load the attendance. Please try again.');
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }

  function selectDay(day: string) {
    setSelected(day);
    setWeekStart(weekStartOf(day));
  }

  function backToToday() {
    if (data.month === monthOf(data.today)) selectDay(data.today);
    else void openMonth(monthOf(data.today));
  }

  function openDialog(action: AttendanceAction) {
    setDialogError(null);
    setDialog(action);
  }

  async function submit(purpose?: Purpose, verification?: VerificationResult) {
    if (!dialog) return;
    setSaving(true);
    setDialogError(null);
    try {
      const body = verification
        ? { action: dialog, verification }
        : purpose
        ? { action: dialog, purpose }
        : { action: dialog };
      const { overview } = await callApi<{ overview: Overview }>('/api/attendance', 'POST', body);
      const last = overview.grid.find(g => g.day === overview.today)?.detail?.history.at(-1);
      show(overview, overview.today);
      setDialog(null);
      toast.success(last ? `${last.label} recorded at ${last.time}.` : 'Saved.');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save. Please try again.';
      if (e instanceof ApiError && e.status === 409) {
        // Another tab or device got there first: show what is recorded now
        setDialog(null);
        toast.error(message);
        void openMonth(data.month);
      } else {
        setDialogError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const day = data.grid.find(g => g.day === selected) ?? data.grid.find(g => g.day === data.defaultDay) ?? data.grid[0];

  return (
    <main className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 sm:py-6">
      <header className="mb-5">
        <h1 className="text-[24px] font-bold tracking-tight text-[#111827]">Attendance</h1>
        <p className="mt-0.5 text-[13px] text-[#6B7280]">Your own check in and out, site movements, working hours and requests.</p>
      </header>

      {!canMark && (
        <p className="mb-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-[13px] text-[#92400E]">You can view attendance but not mark it. Ask an administrator for Attendance - Create access.</p>
      )}
      {error && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-2.5 text-[13px] text-[#B91C1C]">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => void openMonth(month)} className="font-semibold underline">Try again</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_auto_auto_1fr]">
        <div className="lg:col-start-1 lg:row-start-1">
          <CalendarCard overview={data} month={month} selected={selected} loading={loading} onMonth={delta => void openMonth(shiftMonth(month, delta))} onSelect={selectDay} />
        </div>
        <div className="lg:col-start-2 lg:row-span-4 lg:row-start-1">
          <DayPanel overview={data} day={day} canMark={canMark} onAction={openDialog} onToday={backToToday} />
        </div>
        <div className="lg:col-start-1 lg:row-start-2">
          <SummaryCard overview={data} />
        </div>
        <div className="lg:col-start-1 lg:row-start-3">
          <WorkingHoursCard overview={data} weekStart={weekStart} onWeek={setWeekStart} />
        </div>
      </div>

      <div className="mt-5">
        <RequestApprovalsCard />
      </div>

      {dialog === 'CHECK_IN' ? (
        <CheckInCameraModal
          key="check-in-camera"
          busy={saving}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onSubmit={verification => submit(undefined, verification)}
        />
      ) : dialog ? (
        <ActionDialog
          key={dialog}
          action={dialog}
          codes={data.codes}
          busy={saving}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onSubmit={submit}
        />
      ) : null}
    </main>
  );
}
