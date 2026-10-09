// Types and constants of the Attendance module, shared by the server and the browser. No server-only imports here.

// The four office / site movements. Check In and Check Out are stored on the day itself.
export const MOVEMENT_TYPES = ["OFFICE_OUT", "OFFICE_IN", "SITE_IN", "SITE_OUT"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const ATTENDANCE_ACTIONS = ["CHECK_IN", "CHECK_OUT", ...MOVEMENT_TYPES] as const;
export type AttendanceAction = (typeof ATTENDANCE_ACTIONS)[number];
export const isAttendanceAction = (v: unknown): v is AttendanceAction => typeof v === "string" && (ATTENDANCE_ACTIONS as readonly string[]).includes(v);

// What the calendar shows for a day
export type DayKind = "PRESENT" | "ABSENT" | "LEAVE" | "NOT_MARKED" | "WEEKLY_OFF";
export const DAY_KIND_LABELS: Record<DayKind, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LEAVE: "Leave",
  NOT_MARKED: "Not Marked",
  WEEKLY_OFF: "Weekly Off",
};

// What a stored day says. A day nobody marked has no row; Leave and Absent rows are written by the later approval workflow / HR.
export type DayStatus = "PRESENT" | "LEAVE" | "ABSENT";

// Where the person is right now: not started, in the office, out of the office (travelling), at a site, or done for the day
export type Whereabouts = "NOT_STARTED" | "OFFICE" | "OUT" | "SITE" | "DONE";

// What Office Out and Site In ask for: one of the Site Visit Codes, or free text
export type Purpose = { kind: "CODE"; code: string } | { kind: "OTHER"; text: string };
export const MAX_PURPOSE_TEXT = 200;

export type VerificationDetail = {
  method: "FACE" | "THUMB";
  verified: boolean;
  confidence?: number;
  snapshot?: string;
};

export type ActionBody =
  | { action: "CHECK_IN"; verification?: VerificationDetail }
  | { action: "CHECK_OUT" | "OFFICE_IN" | "SITE_OUT" }
  | { action: "OFFICE_OUT" | "SITE_IN"; purpose: Purpose };

export type SiteVisitCodeOption = { code: string; name: string; label: string }; // SV001, Skyline Project, "SV001 - Skyline Project"

// The office hours: minutes after midnight (09:00 = 540) and the weekdays that are the weekly off (0 = Sunday)
export type Schedule = { startMin: number; endMin: number; weeklyOff: number[] };

export type ScheduleView = { startLabel: string; endLabel: string; dailyMin: number; weeklyOff: number[] };

export type HistoryItem = {
  key: string;
  type: "CHECK_IN" | "CHECK_OUT" | MovementType;
  label: string; // Check In, Office Out, Site In 1 ...
  time: string; // 10:15 AM
  at: string; // ISO
  detail: string | null; // SV001 - Skyline Project, Other - Client Meeting
};

// Everything recorded for one day
export type DayDetail = {
  status: DayStatus;
  checkIn: string | null; // 09:05 AM
  checkInAt: string | null;
  checkOut: string | null;
  checkOutAt: string | null;
  shiftMin: number | null; // check out minus check in, once checked out
  expectedStart: string; // 09:00 AM
  expectedEnd: string; // 06:30 PM
  expectedMin: number; // the hours expected that day (0 on a weekly off)
  lateMin: number;
  earlyMin: number;
  overtimeMin: number;
  missingCheckOut: boolean; // a past day that was checked in and never checked out
  workedOnWeeklyOff: boolean;
  history: HistoryItem[];
};

export type GridDay = {
  day: string; // YYYY-MM-DD
  weekday: number; // 0 = Sunday
  inMonth: boolean;
  kind: DayKind;
  workedMin: number;
  overtimeMin: number;
  officeMin: number;
  detail: DayDetail | null; // null: nothing recorded
};

export type Summary = {
  present: number;
  absent: number;
  leave: number;
  notMarked: number;
  weeklyOff: number;
  attendancePct: number | null; // present / (present + absent) on working days; null when there is nothing to count yet
};

export type HoursSummary = {
  totalMin: number;
  overtimeMin: number;
  officeMin: number;
  outMin: number; // time spent out of the office (site visits and other)
  avgMin: number; // total / days worked
  daysWorked: number;
  overtimeDays: number;
  expectedMin: number; // working days of the month x the daily office hours
};

export type Overview = {
  today: string;
  month: string; // YYYY-MM
  monthLabel: string; // October 2026
  defaultDay: string; // the day a freshly opened month selects: today when it is in that month, else the 1st
  schedule: ScheduleView;
  grid: GridDay[]; // whole Sunday-to-Saturday weeks, so a week at the edge of the month is complete
  summary: Summary;
  hours: HoursSummary;
  me: { whereabouts: Whereabouts; allowed: AttendanceAction[] }; // what may be pressed today
  codes: SiteVisitCodeOption[];
};
