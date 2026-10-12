// Shared, dependency-free pieces of the spreadsheet imports (Leads, Deals, Pre-Payments, Payment Collections):
// reading a file into rows, finding a column by its heading, dates, amounts and "which one is meant" matching.
// Pure on purpose (no database, no server-only imports) so the routes and the upload dialogs behave the same and tests can run it.
import type * as XlsxLib from "xlsx";

// A request body above ~4.5 MB is refused by the host before our code runs, so a bigger file can never arrive anyway
export const IMPORT_MAX_BYTES = 4 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
// The dialog sends the rows in small batches: one request has to finish within the host's time limit (about a third of a second a row)
export const IMPORT_BATCH_ROWS = 40;
export const IMPORT_SERVER_ROWS = 200;

export type ImportRow = Record<string, unknown>;
// What to do with a row whose code/number already belongs to a record
export type ImportStrategy = "skip" | "update" | "create_new";

export function normalizeStr(s: unknown): string {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCode(s: unknown): string {
  if (!s) return "";
  return String(s).toLowerCase().replace(/[\s\-_]/g, "");
}

const pad = (n: number) => String(n).padStart(2, "0");

// A date cell of an .xlsx file as text: "2026-03-27", or "2026-03-27 10:15:00" when it has a time
function dateCellText(date: Date): string {
  const d = new Date(Math.round(date.getTime() / 1000) * 1000); // the library's day fractions land a few milliseconds short
  const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  return time === "00:00:00" ? day : `${day} ${time}`;
}

export class ImportFileError extends Error {}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes); // also drops a byte order mark
  } catch {
    return new TextDecoder("windows-1252").decode(bytes); // a CSV saved by Excel in a local code page
  }
}

/**
 * The first sheet of a .csv / .xlsx / .xls file as rows of text keyed by the heading.
 * - A CSV is read as typed (the library would otherwise guess dates as month/day and turn "001" into 1).
 * - A real date cell of a spreadsheet becomes an unambiguous "yyyy-mm-dd" text, never "4/3/26".
 * - Other cells keep the text the person sees in the spreadsheet ("18%", "₹25,000.00").
 */
export function readSheetRows(xlsx: typeof XlsxLib, data: ArrayBuffer | Uint8Array): ImportRow[] {
  const sheet = openSheets(xlsx, data, 1)[0];
  return sheet ? xlsx.utils.sheet_to_json<ImportRow>(sheet, { defval: "", raw: false }) : [];
}

/** Every sheet (up to `limit`) as rows of cells, headings included, for files whose table does not start at the first row (a vendor's quotation) */
export function readSheetMatrices(xlsx: typeof XlsxLib, data: ArrayBuffer | Uint8Array, limit = 5): string[][][] {
  return openSheets(xlsx, data, limit).map(sheet => xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false }).map(r => r.map(c => String(c ?? ""))));
}

function openSheets(xlsx: typeof XlsxLib, data: ArrayBuffer | Uint8Array, limit: number): XlsxLib.WorkSheet[] {
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
  if (bytes.length > IMPORT_MAX_BYTES) throw new ImportFileError(`The file is larger than ${IMPORT_MAX_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  let workbook: XlsxLib.WorkBook;
  try {
    // .xlsx is a zip ("PK"), .xls an OLE file; anything else is text. The library decodes text as Windows-1252 unless there is a
    // byte order mark, which garbles "₹" and every non-English name in a UTF-8 file, so the text is decoded here.
    const binary = (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0);
    workbook = binary
      ? xlsx.read(bytes, { type: "array", cellDates: true })
      : xlsx.read(decodeText(bytes), { type: "string", raw: true });
  } catch {
    throw new ImportFileError("The file could not be read. Please upload a valid CSV or Excel (.xlsx) file.");
  }
  const sheets: XlsxLib.WorkSheet[] = [];
  for (const name of workbook.SheetNames.slice(0, limit)) {
    const sheet = workbook.Sheets[name];
    if (!sheet || !sheet["!ref"]) continue;
    const range = xlsx.utils.decode_range(sheet["!ref"]);
    if (range.e.r - range.s.r > IMPORT_MAX_ROWS) throw new ImportFileError(`A file can have at most ${IMPORT_MAX_ROWS.toLocaleString("en-IN")} rows. Split it into smaller files.`);
    for (const key of Object.keys(sheet)) {
      if (key[0] === "!") continue;
      const cell = sheet[key];
      if (cell && cell.t === "d" && cell.v instanceof Date && !isNaN(cell.v.getTime())) cell.w = dateCellText(cell.v);
    }
    sheets.push(sheet);
  }
  return sheets;
}

// The value under the first heading that matches one of the aliases ("Deals ID" = "deals_id" = "DEALS ID"); "" when empty
export function getField(row: ImportRow, ...aliases: string[]): string {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const k of keys) {
      let cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (k.toLowerCase().startsWith("cf.") || k.toLowerCase().startsWith("cf ")) cleanKey = cleanKey.replace(/^cf/, "");
      if (cleanKey !== cleanAlias) continue;
      const val = row[k];
      if (val === undefined || val === null) continue;
      const str = (val instanceof Date ? (isNaN(val.getTime()) ? "" : dateCellText(val)) : String(val)).trim();
      if (str) return str;
    }
  }
  return "";
}

const EMPTY_DATES = new Set(["", "-", "—", "1899-12-31"]);
const validYear = (d: Date) => !isNaN(d.getTime()) && d.getFullYear() >= 2000;

// A real calendar date (31/02 would roll over to March: that is not a date). Without a time it is the start of the day in UTC
// (what a date column stores), with a time it is local time of the server.
function build(y: number, m: number, d: number, time?: [number, number, number]): Date | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  if (!time) {
    const out = new Date(Date.UTC(y, m, d));
    return out.getUTCMonth() === m && out.getUTCDate() === d && validYear(out) ? out : null;
  }
  const out = new Date(y, m, d, time[0], time[1], time[2]);
  return out.getMonth() === m && out.getDate() === d && validYear(out) ? out : null;
}

/**
 * A date from a file, or null when it is empty or not a date.
 * "2026-03-27" and "2026-03-27 10:15:00" are read as written. A slash date such as "04/03/2026" is read day first (4 March, the
 * usual way in India); when only the second number can be a day ("03/27/2026") it is read month first.
 */
export function parseImportDate(val: unknown): Date | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return validYear(val) ? val : null;
  const str = String(val).trim();
  if (EMPTY_DATES.has(str)) return null;

  // An Excel serial number (e.g. 46108)
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const d = new Date(Math.round((parseFloat(str) - 25569) * 86400 * 1000));
    if (validYear(d)) return d;
  }

  // yyyy-mm-dd, optionally followed by a time
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (iso) {
    const [, y, mo, d, h, mi, s] = iso;
    if (h !== undefined && /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(str)) {
      const withZone = new Date(str);
      return validYear(withZone) ? withZone : null;
    }
    return build(+y, +mo - 1, +d, h === undefined ? undefined : [+h, +mi, +(s ?? 0)]);
  }

  // dd/mm/yyyy or dd-mm-yyyy (2- or 4-digit year), optionally followed by a time
  const slash = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)(?:[\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (slash) {
    const [, p1, p2, py, h, mi, s] = slash;
    const n1 = +p1;
    const n2 = +p2;
    const year = +py < 100 ? +py + 2000 : +py;
    const monthFirst = n1 <= 12 && n2 > 12;
    return build(year, (monthFirst ? n1 : n2) - 1, monthFirst ? n2 : n1, h === undefined ? undefined : [+h, +mi, +(s ?? 0)]);
  }

  const fallback = new Date(str);
  return validYear(fallback) ? fallback : null;
}

/** The calendar day of a parsed date as the start of that day in UTC, for a date column (a date without a time already is one) */
export function toDateOnly(d: Date): Date {
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
  return utcMidnight ? d : new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** A money amount from text such as "₹25,000.00", "Rs. 5", "(1,500)" or "1,50,000"; null when there is no number */
export function parseAmount(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const str = String(val).trim();
  const found = str.match(/-?\s*\d[\d,]*(?:\.\d+)?|-?\s*\.\d+/);
  if (!found) return null;
  const num = parseFloat(found[0].replace(/[\s,]/g, ""));
  if (!isFinite(num)) return null;
  return /^\(.*\)$/.test(str) && num > 0 ? -num : num;
}

/** The one item that passes the test; null when none or more than one does (a guess between two people is worse than no match) */
export function pickUnique<T>(items: readonly T[], test: (item: T) => boolean): T | null {
  let found: T | null = null;
  for (const item of items) {
    if (!test(item)) continue;
    if (found !== null) return null;
    found = item;
  }
  return found;
}

/** Two normalised names are "the same person/thing" when equal, or one holds the other and it is long enough to mean something */
export function looselySame(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && (` ${long} `).includes(` ${short} `);
}
