// Reading the item table of a vendor's quotation. The input is text with a position (the words of a PDF, of an OCR run, or the cells of a sheet);
// the output is the rows of the table: item name, description, quantity, rate and amount. Pure: no browser, no server.
//
// How a table is found: a line that holds the headings (Item / Description, Qty, Rate, Amount ...) fixes the columns by their position; every line
// below it is cut into those columns; a line that starts with a serial number (or has numbers in it) starts a row, a line with only text continues the
// row above; the table ends at Sub Total / Total / Tax lines. Where no headings can be found, lines that end with quantity, rate and amount are used.

import { numText, round2, strictNumber, type VendorRow } from "../vendor-quote";

export type Token = { text: string; x0: number; x1: number; y0: number; y1: number; page: number };
type Role = "sno" | "item" | "desc" | "text" | "qty" | "unit" | "rate" | "amount" | "hsn" | "other";
type Cell = { text: string; x0: number; x1: number };
export type TextLine = { page: number; y0: number; y1: number; tokens: Token[]; cells: Cell[] };
export type Extracted = { rows: VendorRow[]; warnings: string[]; headerFound: boolean };

const median = (a: number[]): number => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

let rowCounter = 0;
export const newRowKey = () => `v_${Date.now().toString(36)}_${(rowCounter++).toString(36)}`;

// ---------------------------------------------------------------------------
// Words -> lines
// ---------------------------------------------------------------------------
/** The words of every page cut into lines (top to bottom) and, for finding the headings, into cells (words close together) */
// `oneCellPerToken`: every word is a cell of its own (the cells of a sheet are cells already)
export function tokensToLines(tokens: Token[], oneCellPerToken = false): TextLine[] {
  const out: TextLine[] = [];
  const pages = Array.from(new Set(tokens.map(t => t.page))).sort((a, b) => a - b);
  for (const page of pages) {
    const toks = tokens.filter(t => t.page === page && t.text.trim() !== "");
    if (!toks.length) continue;
    const h = median(toks.map(t => t.y1 - t.y0)) || 10;
    const cw = median(toks.map(t => (t.x1 - t.x0) / Math.max(1, t.text.trim().length))) || h * 0.5;
    toks.sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
    const groups: Token[][] = [];
    let cur: Token[] = [];
    let curY = 0;
    for (const t of toks) {
      const cy = (t.y0 + t.y1) / 2;
      if (cur.length && Math.abs(cy - curY) <= h * 0.55) {
        cur.push(t);
        curY = (curY * (cur.length - 1) + cy) / cur.length;
      } else {
        if (cur.length) groups.push(cur);
        cur = [t];
        curY = cy;
      }
    }
    if (cur.length) groups.push(cur);
    for (const g of groups) {
      g.sort((a, b) => a.x0 - b.x0);
      const cells: Cell[] = [];
      for (const t of g) {
        const last = cells[cells.length - 1];
        if (last && !oneCellPerToken && t.x0 - last.x1 <= cw * 1.8) {
          last.text = `${last.text} ${t.text.trim()}`;
          last.x1 = Math.max(last.x1, t.x1);
        } else cells.push({ text: t.text.trim(), x0: t.x0, x1: t.x1 });
      }
      out.push({ page, y0: Math.min(...g.map(t => t.y0)), y1: Math.max(...g.map(t => t.y1)), tokens: g, cells });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Headings
// ---------------------------------------------------------------------------
const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9% ]/g, " ").replace(/\s+/g, " ").trim();

export function classifyHeading(raw: string): Role | null {
  if (raw.trim() === "#") return "sno";
  const h = clean(raw);
  if (!h) return null;
  if (/^(s ?no|sl ?no|sr ?no|sno|slno|srno|s n|sl|sr|no|serial( no| number)?|item no|sl no)$/.test(h)) return "sno";
  if (/\b(hsn|sac)\b/.test(h)) return "hsn";
  if (/\b(total|amount|amt|value)\b/.test(h) && !/\b(gst|tax|igst|cgst|sgst|discount)\b/.test(h)) return "amount";
  if (/\b(price|rate|cost|mrp)\b/.test(h) && !/\b(gst|tax)\b/.test(h)) return "rate";
  if (/^(unit|uom|units? of measure|unit of measurement)$/.test(h)) return "unit";
  if (/\b(qty|quantity|qnty|nos|pcs|quantity)\b/.test(h) || /^no of/.test(h) || h === "units") return "qty";
  if (/\b(gst|tax|igst|cgst|sgst|vat|disc|discount)\b/.test(h) || h.includes("%")) return "other";
  const describes = /\b(description|desc|details|specification|specifications|spec)\b/.test(h);
  const names = /\b(item|items|product|products|material|particulars|goods|article|service|work|name)\b/.test(h);
  if (describes && names) return "text";
  if (describes) return "desc";
  if (names) return "item";
  return null;
}

type Column = { role: Role; x0: number; x1: number; lo: number; hi: number };

// A heading is short: a long sentence that happens to hold the word "total" is not one
function rolesOf(cells: { text: string }[]): Role[] {
  return cells.filter(c => c.text.length <= 40).map(c => classifyHeading(c.text)).filter((r): r is Role => r !== null);
}
const isTextRole = (r: Role) => r === "item" || r === "desc" || r === "text";
const isNumRole = (r: Role) => r === "qty" || r === "rate" || r === "amount";

function qualifies(roles: Role[]): boolean {
  return roles.some(isTextRole) && roles.some(isNumRole) && roles.length >= 2;
}

/** The headings of a table may be written over two lines ("Unit" above "Price"): the second line is joined to the first when it sits under its words */
function mergeHeadingLines(lines: TextLine[], i: number): Cell[] {
  const first = lines[i];
  const next = lines[i + 1];
  if (!next || next.page !== first.page) return first.cells;
  const gap = next.y0 - first.y1;
  const lh = first.y1 - first.y0 || 10;
  if (gap > lh * 1.2) return first.cells;
  const under = next.cells.every(c => first.cells.some(f => c.x0 < f.x1 + 4 && c.x1 > f.x0 - 4));
  if (!under || next.cells.some(c => /\d{2,}/.test(c.text))) return first.cells;
  const merged = first.cells.map(f => {
    const below = next.cells.filter(c => c.x0 < f.x1 + 4 && c.x1 > f.x0 - 4);
    return below.length ? { text: `${f.text} ${below.map(b => b.text).join(" ")}`, x0: Math.min(f.x0, ...below.map(b => b.x0)), x1: Math.max(f.x1, ...below.map(b => b.x1)) } : f;
  });
  return qualifies(rolesOf(merged)) && !qualifies(rolesOf(first.cells)) ? merged : first.cells;
}

function buildColumns(cells: Cell[], cw: number): Column[] {
  const cols: Column[] = [];
  for (const c of cells) {
    const role = classifyHeading(c.text) ?? "other";
    cols.push({ role, x0: c.x0, x1: c.x1, lo: 0, hi: 0 });
  }
  // a quotation with only one text heading ("Description"): it is the item and its description in one
  const texts = cols.filter(c => isTextRole(c.role));
  if (texts.length === 1) texts[0].role = "text";
  else if (texts.some(c => c.role === "text")) for (const c of texts) c.role = "text";
  cols.sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < cols.length; i++) {
    const a = cols[i];
    const b = cols[i + 1];
    a.lo = i === 0 ? -Infinity : cols[i - 1].hi;
    if (!b) { a.hi = Infinity; continue; }
    if (isTextRole(a.role) && !isTextRole(b.role)) a.hi = Math.max(a.x1, b.x0 - 0.5 * Math.max(b.x1 - b.x0, 6 * cw));
    else a.hi = (a.x0 + a.x1) / 2 + ((b.x0 + b.x1) / 2 - (a.x0 + a.x1) / 2) / 2;
  }
  return cols;
}

// ---------------------------------------------------------------------------
// Lines of the table -> rows
// ---------------------------------------------------------------------------
const STOP = /^(sub[\s-]*total|grand[\s-]*total|total\b|net (total|amount|payable)|taxable (value|amount)|cgst|sgst|igst|gst\b|round[\s-]*off|discount|amount in words|total in words|rupees|in words|terms|note[s]?\b|bank\b|thank|declaration|authori[sz]ed|e\.? ?& ?o\.? ?e|for\s+[a-z])/i;

type Raw = { sno: string; item: string[]; desc: string[]; text: string[]; qty: string; unit: string; rate: string; amount: string; page: number };
const blankRaw = (page: number): Raw => ({ sno: "", item: [], desc: [], text: [], qty: "", unit: "", rate: "", amount: "", page });

const hasDigit = (s: string) => /\d/.test(s);

function split(line: TextLine, cols: Column[]): Record<Role, string> {
  const out: Record<Role, string> = { sno: "", item: "", desc: "", text: "", qty: "", unit: "", rate: "", amount: "", hsn: "", other: "" };
  const parts = new Map<Column, Token[]>();
  for (const t of line.tokens) {
    const mid = (t.x0 + t.x1) / 2;
    const col = cols.find(c => mid >= c.lo && mid < c.hi) ?? cols[cols.length - 1];
    parts.set(col, [...(parts.get(col) ?? []), t]);
  }
  for (const [col, toks] of parts) {
    const text = toks.sort((a, b) => a.x0 - b.x0).map(t => t.text.trim()).join(" ");
    out[col.role] = out[col.role] ? `${out[col.role]} ${text}` : text;
  }
  return out;
}

const NUM_CELL = /^(?:₹|rs\.?|inr)?\s*-?[\d,]*\.?\d+\s*(?:\/-)?$/i;

function numberOf(s: string): number | null {
  const t = s.replace(/\/-\s*$/, "").trim();
  return NUM_CELL.test(t) ? strictNumber(t) : null;
}

/** "2 Nos" -> 2 and "Nos" */
function quantityOf(s: string): { qty: number | null; unit: string } {
  const m = s.trim().match(/^(-?[\d,]*\.?\d+)\s*([A-Za-z][A-Za-z./]*)?$/);
  if (!m) return { qty: null, unit: "" };
  return { qty: strictNumber(m[1]), unit: m[2] ?? "" };
}

function finish(raw: Raw, warnings: string[], n: number): VendorRow | null {
  const lines = (raw.text.length ? raw.text : [...raw.item, ...raw.desc]).join("\n").split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean);
  let name: string;
  let description: string;
  if (raw.item.length && raw.desc.length) {
    name = raw.item.join(" ").replace(/\s+/g, " ").trim();
    description = raw.desc.join(" ").replace(/\s+/g, " ").trim();
  } else {
    name = lines[0] ?? "";
    description = lines.slice(1).join(" ");
  }
  if (!name) return null;

  const q = quantityOf(raw.qty);
  let qty = q.qty;
  let rate = raw.rate ? numberOf(raw.rate) : null;
  let amount = raw.amount ? numberOf(raw.amount) : null;
  const unit = raw.unit.trim() || q.unit;
  if (qty !== null && rate !== null && amount === null) amount = round2(qty * rate);
  else if (qty !== null && qty > 0 && amount !== null && rate === null) rate = round2(amount / qty);
  else if (qty === null && rate !== null && rate > 0 && amount !== null) {
    const guess = amount / rate;
    if (Math.abs(guess - Math.round(guess)) < 0.01) qty = Math.round(guess);
  } else if (qty === null && rate === null && amount !== null) {
    qty = 1;
    rate = amount;
  }
  if (qty !== null && rate !== null && amount !== null && Math.abs(qty * rate - amount) > Math.max(1, amount * 0.015)) {
    warnings.push(`Row ${n}: the amount is not quantity × rate; it is shown as the file has it.`);
  }
  return {
    key: newRowKey(), name, description,
    quantity: qty === null ? "" : numText(qty), rate: rate === null ? "" : numText(rate), amount: amount === null ? "" : numText(amount), unit,
  };
}

/** The rows of the table whose headings are in `lines[headIndex]`, read until the totals; `at` is where reading goes on */
function readTable(lines: TextLine[], start: number, cols: Column[], warnings: string[], sheet: boolean, counter: { n: number }): { rows: VendorRow[]; end: number } {
  const rows: VendorRow[] = [];
  const hasSno = cols.some(c => c.role === "sno");
  let cur: Raw | null = null;
  let pending: string[] = []; // text lines that wait for the numbers line of their row (tables without serial numbers)
  const close = () => {
    if (cur) {
      counter.n++;
      const r = finish(cur, warnings, counter.n);
      if (r) rows.push(r);
    }
    cur = null;
  };
  const add = (raw: Raw, c: Record<Role, string>) => {
    if (c.item) raw.item.push(c.item);
    if (c.desc) raw.desc.push(c.desc);
    if (c.text) raw.text.push(c.text);
    if (c.qty && !raw.qty) raw.qty = c.qty;
    if (c.unit && !raw.unit) raw.unit = c.unit;
    if (c.rate && !raw.rate) raw.rate = c.rate;
    if (c.amount && !raw.amount) raw.amount = c.amount;
  };

  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    const c = split(line, cols);
    const all = line.cells.map(x => x.text).join(" ").trim();
    const textStr = [c.item, c.desc, c.text].join(" ").trim();
    const sno = hasSno && /^\d{1,3}[.)]?$/.test(c.sno.trim());
    const nums = [c.qty, c.rate, c.amount].filter(s => s && hasDigit(s)).length;

    if (!sno && STOP.test(all) && (nums === 0 || !hasSno || !textStr || STOP.test(textStr))) { close(); return { rows, end: i + 1 }; }
    // the next table's headings (a page that repeats them): hand over to the caller
    if (qualifies(rolesOf(mergeHeadingLines(lines, i))) && !sno) { close(); return { rows, end: i }; }

    if (sno) {
      close();
      pending = [];
      cur = blankRaw(line.page);
      cur.sno = c.sno;
      add(cur, c);
    } else if (nums >= 2 || (nums >= 1 && textStr && !hasSno)) {
      if (cur && !textStr && hasSno) add(cur, c); // numbers on a line of their own, under the name
      else if (cur && !textStr && !cur.qty && !cur.rate && !cur.amount) add(cur, c);
      else {
        close();
        cur = blankRaw(line.page);
        for (const p of pending) cur.text.push(p);
        pending = [];
        add(cur, c);
      }
    } else if (textStr) {
      if (hasSno || (sheet && c.desc && !c.item && !c.text)) { if (cur) add(cur, c); }
      else if (sheet) { /* a heading line between the items ("Living Room"): not an item */ }
      else if (cur && !cur.qty && !cur.rate && !cur.amount) add(cur, c);
      else if (cur && /^[a-z(,\-]/.test(textStr)) add(cur, c); // continues the line above
      else pending.push(c.text || [c.item, c.desc].filter(Boolean).join("\n"));
    } else if (nums === 1 && cur) {
      add(cur, c);
    }
  }
  close();
  return { rows, end: i };
}

/** Lines that end with quantity, rate and amount, when the file has no headings */
function readLoose(lines: TextLine[], warnings: string[]): VendorRow[] {
  const rows: VendorRow[] = [];
  for (const line of lines) {
    const toks = line.tokens.map(t => t.text.trim()).filter(Boolean);
    const all = toks.join(" ");
    if (STOP.test(all)) continue;
    const tail: number[] = [];
    let k = toks.length;
    while (k > 0 && tail.length < 3) {
      const v = numberOf(toks[k - 1]);
      if (v === null) break;
      tail.unshift(v);
      k--;
    }
    if (tail.length < 2) continue;
    const name = toks.slice(0, k).join(" ").replace(/^\d{1,3}[.)]?\s+/, "").replace(/\s+/g, " ").trim();
    if (name.length < 2 || !/[A-Za-z]/.test(name)) continue;
    let qty: number; let rate: number; let amount: number;
    if (tail.length === 3 && Math.abs(tail[0] * tail[1] - tail[2]) <= Math.max(1, Math.abs(tail[2]) * 0.015)) [qty, rate, amount] = tail;
    else if (tail.length === 3) { const [a, b, c] = tail.slice(-3); if (Math.abs(a * b - c) > Math.max(1, Math.abs(c) * 0.015)) continue; [qty, rate, amount] = [a, b, c]; }
    else if (Number.isInteger(tail[0]) && tail[0] > 0 && tail[0] < 100_000) { qty = tail[0]; amount = tail[1]; rate = round2(amount / qty); }
    else continue;
    rows.push({ key: newRowKey(), name, description: "", quantity: numText(qty), rate: numText(rate), amount: numText(amount), unit: "" });
  }
  if (rows.length) warnings.push("No table headings were found. The items were read from the lines that end with quantity, rate and amount; please check every row.");
  return rows;
}

/** The item rows of a document given as words with positions */
export function extractFromTokens(tokens: Token[], opts: { sheet?: boolean } = {}): Extracted {
  const warnings: string[] = [];
  const lines = tokensToLines(tokens, !!opts.sheet);
  if (!lines.length) return { rows: [], warnings, headerFound: false };
  const cw = median(tokens.filter(t => t.text.trim()).map(t => (t.x1 - t.x0) / Math.max(1, t.text.trim().length))) || 5;

  const rows: VendorRow[] = [];
  const counter = { n: 0 };
  let found = false;
  let i = 0;
  while (i < lines.length) {
    const head = mergeHeadingLines(lines, i);
    if (qualifies(rolesOf(head))) {
      found = true;
      const cols = buildColumns(head, cw);
      const skip = head === lines[i].cells ? 1 : 2;
      const res = readTable(lines, i + skip, cols, warnings, !!opts.sheet, counter);
      rows.push(...res.rows);
      i = Math.max(res.end, i + skip);
    } else i++;
  }
  if (!found) return { rows: readLoose(lines, warnings), warnings, headerFound: false };
  return { rows, warnings, headerFound: true };
}

/** The item rows of a sheet given as rows of cells (Excel, CSV) */
export function extractFromMatrix(matrix: string[][]): Extracted {
  const tokens: Token[] = [];
  matrix.forEach((cells, r) => {
    cells.forEach((text, c) => {
      const t = String(text ?? "").replace(/\r/g, "").trim();
      if (!t) return;
      // one word per cell; a cell of several lines keeps its line breaks (the first line is the name, the others its description)
      tokens.push({ text: t.replace(/[ \t]*\n[ \t]*/g, "\n"), x0: c * 100, x1: c * 100 + 90, y0: r * 20, y1: r * 20 + 12, page: 1 });
    });
  });
  return extractFromTokens(tokens, { sheet: true });
}
