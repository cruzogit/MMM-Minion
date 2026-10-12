// Taking quote numbers from the counter. One atomic counter row per number series (key "quote:<series>"): the number is taken inside the
// transaction that saves the quote (or starts its draft), so two people saving at once never get the same number and a failed save does not skip one.
//
// A new quote that is abandoned with "Leave and Discard Changes" gives its number back (QuoteNumberRelease): the next quote of that series takes the
// lowest number given back before the counter moves on, so QT-733 is used again instead of being lost. Only that gives a number back: the number of a
// quote that was saved (even one that was deleted later) is never used a second time.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { ServiceError } from "@/lib/users/service";
import { assertSuperAdmin } from "@/lib/users/layout";
import { renderNumber, seriesOf } from "./numbering";
import type { NumberingSettings } from "./types";

type Tx = Prisma.TransactionClient;

export async function allocateNumber(tx: Tx, n: NumberingSettings, day: string) {
  const { series, key } = seriesOf(n, day);
  // A number that was given back is used first (the lowest). SKIP LOCKED: two people starting a quote at the same moment never wait for, or take, the same one.
  const back = await tx.$queryRaw<{ seq: number }[]>`
    DELETE FROM "QuoteNumberRelease" WHERE "series" = ${series} AND "seq" = (
      SELECT "seq" FROM "QuoteNumberRelease" WHERE "series" = ${series} ORDER BY "seq" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING "seq"`;
  if (back[0]) {
    const seq = Number(back[0].seq);
    return { number: renderNumber(n, day, seq), series, seq };
  }
  // A series that has no counter yet starts with the first number of the settings; after that it counts up by one
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES (${key}, ${n.startNumber}, now())
    ON CONFLICT ("key") DO UPDATE SET "value" = "Counter"."value" + 1, "updatedAt" = now()
    RETURNING "value"`;
  const seq = Number(rows[0].value);
  return { number: renderNumber(n, day, seq), series, seq };
}

/** Gives the number of an abandoned new quote back. Not done when a saved quote carries it (that number is gone for good). */
export async function releaseNumber(tx: Tx, series: string, seq: number): Promise<boolean> {
  const used = await tx.quote.count({ where: { numberSeries: series, numberSeq: seq } }); // deleted quotes count too
  if (used > 0) return false;
  await tx.$executeRaw`INSERT INTO "QuoteNumberRelease" ("series", "seq") VALUES (${series}, ${seq}) ON CONFLICT DO NOTHING`;
  return true;
}

// What the next quote of a day will be called (shown in the form; the real number is taken when the quote is saved)
export async function peekNumber(n: NumberingSettings, day: string) {
  const { series, key } = seriesOf(n, day);
  const [row, back] = await Promise.all([
    prisma.counter.findUnique({ where: { key }, select: { value: true } }),
    prisma.quoteNumberRelease.findFirst({ where: { series }, orderBy: { seq: "asc" }, select: { seq: true } }),
  ]);
  const next = back ? back.seq : row ? row.value + 1 : n.startNumber;
  return { number: renderNumber(n, day, next), series, next };
}

// Super Admin: "the next quote is number N" for the series of a day. N must be higher than every number already used in the series.
export async function setNextNumber(ctx: AuthContext, n: NumberingSettings, day: string, next: number) {
  assertSuperAdmin(ctx);
  if (!Number.isInteger(next) || next < 1 || next > 999_999_999) throw new ServiceError(400, "The next number must be a whole number from 1 to 999999999.");
  const { series, key } = seriesOf(n, day);
  const [used, reserved] = await Promise.all([
    prisma.quote.aggregate({ where: { numberSeries: series }, _max: { numberSeq: true } }), // deleted quotes count too: a number is never reused
    prisma.quoteDraft.aggregate({ where: { numberSeries: series }, _max: { numberSeq: true } }), // numbers reserved by quotes in progress
  ]);
  const max = Math.max(used._max.numberSeq ?? 0, reserved._max.numberSeq ?? 0);
  if (next <= max) throw new ServiceError(409, `${renderNumber(n, day, max)} is already used, so the next number has to be higher than ${max}.`);
  const before = await prisma.counter.findUnique({ where: { key }, select: { value: true } });
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO "Counter" ("key", "value", "updatedAt") VALUES (${key}, ${next - 1}, now())
      ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()`;
    await tx.quoteNumberRelease.deleteMany({ where: { series } }); // numbers given back earlier are below the new start: the Super Admin chose where the series goes on
    await writeAudit({ action: "QUOTE_NUMBER_SET", actorUserId: ctx.userId, oldValue: { series, next: (before?.value ?? n.startNumber - 1) + 1 }, newValue: { series, next } }, tx);
  });
  return peekNumber(n, day);
}
