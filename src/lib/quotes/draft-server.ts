// Auto-save of the quote form, the part that talks to the database. Two kinds of working copy (table QuoteDraft):
//   - a NEW quote that is not saved yet: it holds the quote number reserved for it. Save turns it into the quote with that same number (createQuote);
//     "Leave and Discard Changes" deletes it and gives the number back (the next new quote uses it).
//   - the working copy of a SAVED quote that is being edited: the quote itself is not touched until Save (updateQuote); "Leave and Discard Changes"
//     deletes only the copy, so the quote and its number stay exactly as they were.
// Every save of a working copy carries the rev it was based on: a save with an older rev is refused (409), so two windows never overwrite each other and an
// older request that arrives late cannot undo a newer one. Only the person who started a working copy can read, change or delete it.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";
import { ServiceError } from "@/lib/users/service";
import { isRealDay, todayDay } from "@/lib/leads/format";
import { isId } from "@/lib/records/values";
import { needQuotes } from "./access";
import { draftSummary, MAX_DRAFT_BYTES, parseDraftState, type DraftState } from "./draft";
import { allocateNumber, releaseNumber } from "./numbering-server";
import { loadSettings } from "./settings";

type Tx = Prisma.TransactionClient;
const TX = { maxWait: 10_000, timeout: 20_000 };
export const MAX_NEW_DRAFTS = 20; // quotes in progress one person can have at the same time

export type DraftHeader = { id: string; rev: number; quoteNumber: string | null; updatedAt: string };
export type DraftRecord = DraftHeader & { quoteId: string | null; state: DraftState; baseUpdatedAt: string | null; createdAt: string };
export type DraftListItem = {
  id: string;
  kind: "new" | "edit";
  quoteId: string | null;
  number: string;
  subject: string;
  customer: string;
  items: number;
  updatedAt: string;
  href: string;
};

type Row = Prisma.QuoteDraftGetPayload<object>;
const header = (r: Row): DraftHeader => ({ id: r.id, rev: r.rev, quoteNumber: r.quoteNumber, updatedAt: r.updatedAt.toISOString() });
const gone = () => new ServiceError(404, "This quote in progress no longer exists: it was saved or discarded.");
const stale = () => new ServiceError(409, "This quote was changed in another window or tab. Reload to see the latest, or keep this version to overwrite it.");

/** The state a client sent, checked: the right shape and not too big. It is not checked as a quote: Save does that. */
export function checkState(raw: unknown): DraftState {
  const state = parseDraftState(raw);
  if (!state) throw new ServiceError(400, "The quote in progress is not valid.");
  if (JSON.stringify(state).length > MAX_DRAFT_BYTES) throw new ServiceError(413, "The quote is too big to be saved automatically.");
  return state;
}

const json = (s: DraftState) => s as unknown as Prisma.InputJsonValue;

type Saved = { id: string; rev: number; quoteNumber: string | null; updatedAt: Date };
const savedHeader = (r: Saved): DraftHeader => ({ id: r.id, rev: Number(r.rev), quoteNumber: r.quoteNumber, updatedAt: new Date(r.updatedAt).toISOString() });

// ---------------------------------------------------------------------------
// A new quote
// ---------------------------------------------------------------------------
/** The first save of a new quote: the draft is created and the quote number is reserved for it */
export async function createNewDraft(ctx: AuthContext, raw: unknown): Promise<DraftHeader> {
  needQuotes(ctx, "create");
  const state = checkState(raw);
  const open = await prisma.quoteDraft.count({ where: { userId: ctx.userId, quoteId: null } });
  if (open >= MAX_NEW_DRAFTS) throw new ServiceError(409, `You have ${open} quotes in progress. Save or discard some of them first.`);
  const settings = await loadSettings();
  const typed = state.values.date;
  const day = typeof typed === "string" && isRealDay(typed) ? typed : todayDay();
  return prisma.$transaction(async tx => {
    const num = await allocateNumber(tx, settings.numbering, day);
    const row = await tx.quoteDraft.create({ data: { userId: ctx.userId, quoteId: null, state: json(state), quoteNumber: num.number, numberSeries: num.series, numberSeq: num.seq } });
    return header(row);
  }, TX);
}

/** Later saves of a new quote. `force` keeps this version whatever the server holds (the person chose it after a conflict). */
export async function saveNewDraft(ctx: AuthContext, id: string, raw: unknown, rev: number, force = false): Promise<DraftHeader> {
  needQuotes(ctx, "create");
  if (!isId(id)) throw gone();
  const state = checkState(raw);
  const rows = await prisma.$queryRaw<Saved[]>`
    UPDATE "QuoteDraft" SET "state" = ${JSON.stringify(state)}::jsonb, "rev" = "rev" + 1, "updatedAt" = now()
    WHERE "id" = ${id} AND "userId" = ${ctx.userId} AND "quoteId" IS NULL AND (${force} OR "rev" = ${rev})
    RETURNING "id", "rev", "quoteNumber", "updatedAt"`;
  if (rows[0]) return savedHeader(rows[0]);
  const there = await prisma.quoteDraft.findFirst({ where: { id, userId: ctx.userId, quoteId: null }, select: { id: true } });
  throw there ? stale() : gone();
}

/** "Leave and Discard Changes" on a new quote: the draft is deleted for good (the rows of the quote are in it) and its number is given back */
export async function discardNewDraft(ctx: AuthContext, id: string): Promise<{ discarded: boolean; released: string | null }> {
  needQuotes(ctx, "create");
  if (!isId(id)) return { discarded: false, released: null };
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<{ quoteNumber: string | null; numberSeries: string | null; numberSeq: number | null }[]>`
      SELECT "quoteNumber", "numberSeries", "numberSeq" FROM "QuoteDraft" WHERE "id" = ${id} AND "userId" = ${ctx.userId} AND "quoteId" IS NULL FOR UPDATE`;
    const row = rows[0];
    if (!row) return { discarded: false, released: null };
    await tx.quoteDraft.delete({ where: { id } });
    const back = row.numberSeries !== null && row.numberSeq !== null ? await releaseNumber(tx, row.numberSeries, Number(row.numberSeq)) : false;
    return { discarded: true, released: back ? row.quoteNumber : null };
  }, TX);
}

// ---------------------------------------------------------------------------
// A saved quote being edited
// ---------------------------------------------------------------------------
/** Saves the working copy of a saved quote (rev null = the first save of the copy). The quote itself is not touched. */
export async function saveEditDraft(ctx: AuthContext, quoteId: string, raw: unknown, rev: number | null, force = false): Promise<DraftHeader> {
  needQuotes(ctx, "edit");
  if (!isId(quoteId)) throw new ServiceError(404, "Quote not found");
  const state = checkState(raw);
  const quote = await prisma.quote.findFirst({ where: { id: quoteId, deletedAt: null }, select: { id: true, status: true, updatedAt: true } });
  if (!quote) throw new ServiceError(404, "Quote not found");
  if (quote.status === "Invoiced") throw new ServiceError(409, "An invoiced quote cannot be edited.");
  if (rev === null) {
    try {
      return header(await prisma.quoteDraft.create({ data: { userId: ctx.userId, quoteId, state: json(state), baseUpdatedAt: quote.updatedAt } }));
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      if (!force) throw stale(); // a working copy exists already (another window started it)
      const rows = await prisma.$queryRaw<Saved[]>`
        UPDATE "QuoteDraft" SET "state" = ${JSON.stringify(state)}::jsonb, "rev" = "rev" + 1, "updatedAt" = now()
        WHERE "userId" = ${ctx.userId} AND "quoteId" = ${quoteId} RETURNING "id", "rev", "quoteNumber", "updatedAt"`;
      if (!rows[0]) throw gone();
      return savedHeader(rows[0]);
    }
  }
  const rows = await prisma.$queryRaw<Saved[]>`
    UPDATE "QuoteDraft" SET "state" = ${JSON.stringify(state)}::jsonb, "rev" = "rev" + 1, "updatedAt" = now()
    WHERE "userId" = ${ctx.userId} AND "quoteId" = ${quoteId} AND (${force} OR "rev" = ${rev})
    RETURNING "id", "rev", "quoteNumber", "updatedAt"`;
  if (rows[0]) return savedHeader(rows[0]);
  const there = await prisma.quoteDraft.findUnique({ where: { userId_quoteId: { userId: ctx.userId, quoteId } }, select: { id: true } });
  throw there ? stale() : gone();
}

/** "Leave and Discard Changes" on a saved quote: only the working copy is deleted; the quote and its number are not touched */
export async function discardEditDraft(ctx: AuthContext, quoteId: string): Promise<{ discarded: boolean }> {
  needQuotes(ctx, "edit");
  if (!isId(quoteId)) return { discarded: false };
  const r = await prisma.quoteDraft.deleteMany({ where: { userId: ctx.userId, quoteId } });
  return { discarded: r.count > 0 };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
const record = (r: Row): DraftRecord => ({
  ...header(r), quoteId: r.quoteId, state: parseDraftState(r.state) as DraftState, baseUpdatedAt: r.baseUpdatedAt ? r.baseUpdatedAt.toISOString() : null, createdAt: r.createdAt.toISOString(),
});

const valid = (r: Row | null): r is Row => !!r && parseDraftState(r.state) !== null;

export async function getNewDraft(ctx: AuthContext, id: string): Promise<DraftRecord | null> {
  if (!isId(id)) return null;
  const r = await prisma.quoteDraft.findFirst({ where: { id, userId: ctx.userId, quoteId: null } });
  return valid(r) ? record(r) : null;
}

/** The newest new quote in progress of this person (Add Quote offers to go on with it) */
export async function latestNewDraft(ctx: AuthContext): Promise<DraftRecord | null> {
  const r = await prisma.quoteDraft.findFirst({ where: { userId: ctx.userId, quoteId: null }, orderBy: { updatedAt: "desc" } });
  return valid(r) ? record(r) : null;
}

export async function getEditDraft(ctx: AuthContext, quoteId: string): Promise<DraftRecord | null> {
  if (!isId(quoteId)) return null;
  const r = await prisma.quoteDraft.findUnique({ where: { userId_quoteId: { userId: ctx.userId, quoteId } } });
  return valid(r) ? record(r) : null;
}

/** Everything this person has in progress, newest first (the bar on the Quotes page) */
export async function listMyDrafts(ctx: AuthContext): Promise<DraftListItem[]> {
  const rows = await prisma.quoteDraft.findMany({
    where: { userId: ctx.userId, OR: [{ quoteId: null }, { quote: { is: { deletedAt: null } } }] },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: { quote: { select: { quoteNumber: true } } },
  });
  return rows.flatMap(r => {
    const state = parseDraftState(r.state);
    if (!state) return [];
    const s = draftSummary(state);
    return [{
      id: r.id, kind: r.quoteId ? ("edit" as const) : ("new" as const), quoteId: r.quoteId, number: r.quoteId ? r.quote?.quoteNumber ?? "" : r.quoteNumber ?? "",
      subject: s.subject, customer: s.customer, items: s.items, updatedAt: r.updatedAt.toISOString(),
      href: r.quoteId ? `/quotes/${r.quoteId}/edit` : `/quotes/new?draft=${r.id}`,
    }];
  });
}

// ---------------------------------------------------------------------------
// Used by createQuote / updateQuote, inside their transactions
// ---------------------------------------------------------------------------
/** Save of a new quote: the draft is locked, its reserved number is handed over and the draft is deleted in the same transaction as the quote is created */
export async function claimNewDraft(tx: Tx, ctx: AuthContext, draftId: string): Promise<{ number: string; series: string | null; seq: number | null }> {
  const rows = await tx.$queryRaw<{ quoteNumber: string | null; numberSeries: string | null; numberSeq: number | null }[]>`
    SELECT "quoteNumber", "numberSeries", "numberSeq" FROM "QuoteDraft" WHERE "id" = ${draftId} AND "userId" = ${ctx.userId} AND "quoteId" IS NULL FOR UPDATE`;
  const row = rows[0];
  if (!row || !row.quoteNumber) throw new ServiceError(409, "This quote was already saved or discarded.");
  await tx.quoteDraft.delete({ where: { id: draftId } });
  return { number: row.quoteNumber, series: row.numberSeries, seq: row.numberSeq === null ? null : Number(row.numberSeq) };
}

/** Save of an edited quote: its working copy is not needed any more */
export async function dropEditDraft(tx: Tx, ctx: AuthContext, quoteId: string): Promise<void> {
  await tx.quoteDraft.deleteMany({ where: { userId: ctx.userId, quoteId } });
}

/** A number typed by hand must not be the number another quote in progress is holding */
export async function numberIsReserved(tx: Tx, number: string, exceptDraftId: string | null): Promise<boolean> {
  const hit = await tx.quoteDraft.findFirst({ where: { quoteNumber: number, ...(exceptDraftId ? { id: { not: exceptDraftId } } : {}) }, select: { id: true } });
  return !!hit;
}
