// What the Add / Edit Quote page does when it opens and a quote in progress exists: carry on silently (a refresh), or ask first (coming back later). No
// browser or server imports: the page reads the working copy, the copy kept on the device and the tab, and this decides.

import { draftSignature, hasMeaningfulData, type DraftState } from "./draft";

/** The working copy as the server page hands it over */
export type ServerDraft = { id: string; rev: number; quoteNumber: string | null; updatedAt: string; state: DraftState };
/** A new quote in progress, as the Add Quote page offers it */
export type PendingDraft = { id: string; number: string; subject: string; customer: string; items: number; updatedAt: string; href: string };
/** The copy of the form kept on this device while the server did not have the newest version yet */
export type DeviceCopy = { at: number; state: DraftState };

/** How the form opens */
export type FormBoot = {
  draft: { id: string; rev: number; quoteNumber: string | null } | null; // the working copy that exists on the server
  state: DraftState | null; // what the form starts with instead of the saved quote / a blank form
  startDirty: boolean; // that state is not on the server yet
  notice: string | null; // "Continuing your unfinished quote ..."
};

export type Resume =
  | { kind: "open"; boot: FormBoot; dropCopy: boolean }
  | { kind: "ask-edit"; boot: FormBoot; dropCopy: boolean; since: string | null } // a saved quote with unsaved changes: continue them or leave them
  | { kind: "ask-new"; pending: PendingDraft; dropCopy: boolean }; // Add Quote while an unfinished quote exists

export const COPY_MAX_AGE_MS = 14 * 24 * 3600 * 1000;
/** The device clock and the server clock may differ a little: a copy this much older than the server's version is not newer */
const CLOCK_SLACK_MS = 60_000;

export function decideResume(a: {
  mode: "create" | "edit";
  serverDraft: ServerDraft | null;
  pending: PendingDraft[];
  copy: DeviceCopy | null;
  sameTab: boolean; // this tab was on this quote before (a refresh)
  now: number;
  fmt: (iso: string) => string;
}): Resume {
  const { mode, serverDraft: server, copy, now, fmt } = a;
  let state: DraftState | null = server ? server.state : null;
  let startDirty = false;
  let recovered = false;
  let dropCopy = false;

  if (copy) {
    if (now - copy.at > COPY_MAX_AGE_MS) dropCopy = true;
    else if (server) {
      if (draftSignature(copy.state) === draftSignature(server.state)) dropCopy = true; // the server has it all
      else if (copy.at >= Date.parse(server.updatedAt) - CLOCK_SLACK_MS) { state = copy.state; startDirty = true; recovered = true; } // the device has the newer one
      else dropCopy = true;
    } else if (mode === "edit" || hasMeaningfulData(copy.state)) { state = copy.state; startDirty = true; recovered = true; } // the server never got it
    else dropCopy = true;
  }

  const boot: FormBoot = {
    draft: server ? { id: server.id, rev: server.rev, quoteNumber: server.quoteNumber } : null,
    state,
    startDirty,
    notice: recovered
      ? "Your latest changes were restored from this device and are being saved."
      : server
        ? mode === "edit" ? `Your unsaved changes from ${fmt(server.updatedAt)} were restored.` : `Continuing your unfinished quote${server.quoteNumber ? ` ${server.quoteNumber}` : ""} (saved ${fmt(server.updatedAt)}).`
        : null,
  };

  if (mode === "edit") {
    if (state && !a.sameTab) return { kind: "ask-edit", boot, dropCopy, since: server ? fmt(server.updatedAt) : copy ? fmt(new Date(copy.at).toISOString()) : null };
    return { kind: "open", boot, dropCopy };
  }
  if (!state && a.pending.length) return { kind: "ask-new", pending: a.pending[0], dropCopy };
  return { kind: "open", boot, dropCopy };
}

/** The form with nothing carried over: the saved quote as it is, or a blank form */
export const FRESH: FormBoot = { draft: null, state: null, startDirty: false, notice: null };
