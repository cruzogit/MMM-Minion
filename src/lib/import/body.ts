// What every import route takes and answers: a batch of rows read from the file in the browser, how to treat a row that already
// exists, and how many rows came before this batch (for the row numbers in the report).
import { z } from "zod";
import { IMPORT_SERVER_ROWS } from "./sheet";

// Stop taking new rows after this long; the dialog sends the rest again (the host stops a request at 60 seconds)
export const IMPORT_BUDGET_MS = 45_000;

const cell = z.union([z.string().max(40_000), z.number(), z.null()]);

export const importBody = z
  .object({
    rows: z.array(z.record(z.string().max(200), cell)).min(1).max(IMPORT_SERVER_ROWS),
    duplicateStrategy: z.enum(["skip", "update", "create_new"]).default("skip"),
    rowOffset: z.number().int().min(0).max(1_000_000).default(0),
  })
  .strict();

/** What to tell the person about a row that failed in the database: no table names, no file paths from the server */
export function describeRowFailure(err: unknown): string {
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : "";
  if (code === "P2002") return "A value that has to be unique (a number or code) already exists.";
  if (code === "P2003" || code === "P2025") return "A record this row points to does not exist.";
  if (code === "P2028") return "The row took too long to save. Try again.";
  return "The row could not be saved. Check its values and try again.";
}
