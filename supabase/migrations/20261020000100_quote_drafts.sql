-- Auto-save of the Add Quote / Edit Quote pages: where the work in progress is kept, and the quote numbers that were given back.
-- Additive only: two new, empty tables. Nothing that exists is changed (no quote, no counter, no column).
--
--   "QuoteDraft"          the working copy of a quote form exactly as it was typed (every row, also a half-typed one, and where the cursor was).
--                         quoteId NULL = a NEW quote that is not saved yet: it holds the quote number reserved for it. quoteId set = the
--                         working copy of a SAVED quote that is being edited: the saved quote itself is not touched until Save, so leaving
--                         with "Leave and Discard Changes" only deletes this row. One working copy per person per saved quote.
--                         "rev" goes up at every save and a save that carries an older rev is refused (two windows never overwrite each other).
--   "QuoteNumberRelease"  quote numbers of new quotes that were abandoned with "Leave and Discard Changes": the next new quote of that series
--                         takes the lowest of them before the counter moves on, so QT-733 is used again instead of being lost.
-- Row Level Security on and no direct grant to anon / authenticated, like the other tables: only the server reads and writes them.
-- To undo: DROP TABLE "QuoteDraft"; DROP TABLE "QuoteNumberRelease";

CREATE TABLE IF NOT EXISTS "QuoteDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "quoteId" TEXT,
    "state" JSONB NOT NULL,
    "rev" INTEGER NOT NULL DEFAULT 1,
    "baseUpdatedAt" TIMESTAMP(3),
    "quoteNumber" TEXT,
    "numberSeries" TEXT,
    "numberSeq" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "QuoteDraft_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "QuoteDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteDraft_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteDraft_userId_quoteId_key" ON "QuoteDraft"("userId", "quoteId");
CREATE UNIQUE INDEX IF NOT EXISTS "QuoteDraft_quoteNumber_key" ON "QuoteDraft"("quoteNumber") WHERE "quoteNumber" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "QuoteDraft_userId_updatedAt_idx" ON "QuoteDraft"("userId", "updatedAt");

CREATE TABLE IF NOT EXISTS "QuoteNumberRelease" (
    "series" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteNumberRelease_pkey" PRIMARY KEY ("series", "seq")
);

ALTER TABLE "QuoteDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "QuoteNumberRelease" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "QuoteDraft", "QuoteNumberRelease" FROM anon, authenticated;
