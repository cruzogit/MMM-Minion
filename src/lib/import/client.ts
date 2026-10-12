// The browser side of the imports (Leads, Deals, Pre-Payments, Payment Collections): read the file here, send the rows to the server
// a few at a time, add up the answers. Reading in the browser keeps the file out of the request (a host refuses a body above ~4.5 MB)
// and a long file never has to fit in the time limit of one request.
import { IMPORT_BATCH_ROWS, IMPORT_MAX_BYTES, readSheetRows, type ImportRow, type ImportStrategy } from "./sheet";

export const IMPORT_FILE_TYPES = ".csv, .xlsx, .xls";

/** The rows of a .csv / .xlsx / .xls file. Throws an Error whose message can be shown to the person as it is. */
export async function readImportFile(file: File): Promise<ImportRow[]> {
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw new Error("Please upload a .csv, .xlsx, or .xls file.");
  if (file.size > IMPORT_MAX_BYTES) throw new Error(`The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  const XLSX = await import("xlsx"); // large: loaded only when somebody picks a file
  return readSheetRows(XLSX, await file.arrayBuffer());
}

export type ImportTotals<E, W = never> = { total: number; imported: number; updated: number; skipped: number; errors: E[]; warnings: W[] };

type BatchAnswer<E, W> = { processed: number; imported: number; updated: number; skipped: number; errors?: E[]; warnings?: W[]; error?: string };

/**
 * Sends the rows in batches and adds up what the server answers. `failure` is set when a request failed; the totals then hold
 * what was done before that, so the person can see it (and start again with "skip duplicates" to carry on).
 */
export async function sendInBatches<E, W = never>(
  url: string,
  rows: ImportRow[],
  duplicateStrategy: ImportStrategy,
  onProgress: (done: number) => void,
): Promise<{ totals: ImportTotals<E, W>; failure: string | null }> {
  const totals: ImportTotals<E, W> = { total: rows.length, imported: 0, updated: 0, skipped: 0, errors: [], warnings: [] };
  let done = 0;
  try {
    while (done < rows.length) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: rows.slice(done, done + IMPORT_BATCH_ROWS), duplicateStrategy, rowOffset: done }),
      });
      const data: BatchAnswer<E, W> | null = await res.json().catch(() => null);
      if (!res.ok || !data) {
        const where = done > 0 ? ` The first ${done} rows were saved; run it again with "Skip duplicates" to carry on.` : "";
        throw new Error((data?.error || `The import failed (${res.status}).`) + where);
      }
      totals.imported += data.imported;
      totals.updated += data.updated;
      totals.skipped += data.skipped;
      totals.errors.push(...(data.errors ?? []));
      totals.warnings.push(...(data.warnings ?? []));
      done += Math.max(1, data.processed); // the server may stop early (its time budget): the rest is sent again
      onProgress(Math.min(done, rows.length));
    }
    return { totals, failure: null };
  } catch (err) {
    console.error("Import error:", err);
    return { totals, failure: err instanceof Error ? err.message : "An error occurred during import." };
  }
}
