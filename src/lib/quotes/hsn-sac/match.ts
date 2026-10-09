// Which HSN code (Goods) or SAC (Service) fits an item name. The name and every name in the code tables are cut into comparable words (./text); a word weighs
// more the fewer codes use it ("gypsum" tells more than "light"); a code scores by how much of its best-fitting name is found in the item name and, less strictly,
// how much of the item name that name explains. Pure: the server route and the tests use it as it is.

import type { ItemKind } from "../item-constants";
import type { CodeSuggestion, CodeSuggestions } from "../types";
import { entriesOf, type CodeEntry } from "./tables";
import { analyse } from "./text";

// A score of at least FILL is good enough to be put in the box on its own (when no code of another heading is nearly as good, or the name is exactly one of the
// names of the code); at least OFFER is good enough to be shown as a choice.
export const FILL = 0.62;
export const SURE = 0.9;
export const OFFER = 0.5;
const MARGIN = 0.08;
const MAX_OTHERS = 3;
const MAX_QUERY_WORDS = 14;
const BETA2 = 0.25; // how much less the share of the item name that a table name explains counts than the share of the table name found in the item name
const DESC_FACTOR = 0.9; // the official wording of a code counts a little less than the names people give
const HEAD_MISS = 0.85; // a name whose last word (the thing itself: "pump" in "water pump") is not in the table name is probably about something else
const RUN_BONUS = 0.05; // the table name appears in the item name as it is, in order
const LEFT_OUT = 0.97; // a table name that has words left out ("socket set" is read as "socket") is a little less exact than "socket" itself

type Phrase = { tokens: string[]; set: Set<string>; leftOut: number };
type Row = { entry: CodeEntry; phrases: Phrase[]; desc: Phrase };
type Index = { rows: Row[]; weight: Map<string, number>; unknown: number };
type Query = { tokens: string[]; set: Set<string>; weight: number; head: string };
type Scored = { row: Row; score: number; at: number };

const indexes = new Map<ItemKind, Index>();

const phraseOf = (text: string, service: boolean): Phrase | null => {
  const { tokens, words } = analyse(text, service);
  return tokens.length ? { tokens, set: new Set(tokens), leftOut: Math.min(3, Math.max(0, words - tokens.length)) } : null;
};

function indexOf(kind: ItemKind): Index {
  const hit = indexes.get(kind);
  if (hit) return hit;
  const service = kind === "Service";
  const rows: Row[] = entriesOf(kind).map(entry => ({
    entry,
    phrases: entry.names.flatMap(n => { const p = phraseOf(n, service); return p ? [p] : []; }),
    desc: phraseOf(entry.description, service) ?? { tokens: [], set: new Set<string>(), leftOut: 0 },
  }));
  // how many codes use each word: the fewer, the more the word says
  const df = new Map<string, number>();
  for (const r of rows) {
    const vocabulary = new Set<string>(r.desc.set);
    for (const p of r.phrases) for (const t of p.set) vocabulary.add(t);
    for (const t of vocabulary) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const weight = new Map<string, number>();
  for (const [t, d] of df) weight.set(t, Math.log(1 + rows.length / d));
  const index: Index = { rows, weight, unknown: Math.log(1 + rows.length) }; // a word no code uses (a brand, a typo) weighs as much as a very rare one
  indexes.set(kind, index);
  return index;
}

// Does `part` appear in `all` as it is, word after word?
function runIn(all: string[], part: string[]): boolean {
  for (let i = 0; i + part.length <= all.length; i++) {
    let k = 0;
    while (k < part.length && all[i + k] === part[k]) k++;
    if (k === part.length) return true;
  }
  return false;
}

function queryOf(name: string, kind: ItemKind, index: Index): Query | null {
  const tokens = analyse(name.slice(0, 300), kind === "Service").tokens.slice(0, MAX_QUERY_WORDS);
  if (!tokens.length) return null;
  const set = new Set(tokens);
  let weight = 0;
  for (const t of set) weight += index.weight.get(t) ?? index.unknown;
  return { tokens, set, weight, head: tokens[tokens.length - 1] };
}

function scorePhrase(q: Query, p: Phrase, index: Index): number {
  let found = 0;
  let own = 0;
  for (const t of p.set) {
    const w = index.weight.get(t) ?? index.unknown;
    own += w;
    if (q.set.has(t)) found += w;
  }
  if (found === 0) return 0;
  const precision = found / own; // how much of the table name is in the item name
  const recall = found / q.weight; // how much of the item name the table name explains
  let s = ((1 + BETA2) * precision * recall) / (BETA2 * precision + recall);
  if ((p.tokens.length > 1 || q.tokens.length === 1) && runIn(q.tokens, p.tokens)) s += RUN_BONUS;
  if (q.tokens.length > 1 && !p.set.has(q.head)) s *= HEAD_MISS;
  return s * LEFT_OUT ** p.leftOut;
}

// Where several codes fit the name equally well: a sole sub-heading beats its heading (it is the more exact answer); when several sub-headings fit equally,
// the heading that holds them says it without guessing which; otherwise the code that comes first in the tables wins.
function pick(tied: Scored[]): Scored {
  const subs = tied.filter(x => x.row.entry.code.length > 4);
  if (subs.length === 1) return subs[0];
  if (subs.length > 1) {
    const heading = tied.find(x => x.row.entry.code.length === 4 && subs.some(s => s.row.entry.code.startsWith(x.row.entry.code)));
    if (heading) return heading;
  }
  return tied[0];
}

const suggestion = (s: Scored): CodeSuggestion => ({ code: s.row.entry.code, description: s.row.entry.description, score: Math.round(s.score * 100) / 100 });

// The name of a code that fits best, for the tests: which words of the table matched (not used by the form)
export function explainCodes(name: string, kind: ItemKind, limit = 6): { code: string; score: number; by: string }[] {
  const index = indexOf(kind);
  const q = queryOf(name, kind, index);
  if (!q) return [];
  const out: { code: string; score: number; by: string }[] = [];
  for (const row of index.rows) {
    let s = 0;
    let by = "";
    row.phrases.forEach((p, i) => { const v = scorePhrase(q, p, index); if (v > s) { s = v; by = row.entry.names[i] ?? ""; } });
    if (row.desc.tokens.length) { const v = scorePhrase(q, row.desc, index) * DESC_FACTOR; if (v > s) { s = v; by = `(description) ${row.entry.description}`; } }
    if (s > 0) out.push({ code: row.entry.code, score: Math.round(s * 100) / 100, by });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

function rank(name: string, kind: ItemKind): { chosen: Scored; others: Scored[] } | null {
  const index = indexOf(kind);
  const q = queryOf(name, kind, index);
  if (!q) return null;
  const scored: Scored[] = [];
  index.rows.forEach((row, at) => {
    let s = 0;
    for (const p of row.phrases) { const v = scorePhrase(q, p, index); if (v > s) s = v; }
    if (row.desc.tokens.length) { const v = scorePhrase(q, row.desc, index) * DESC_FACTOR; if (v > s) s = v; }
    if (s >= OFFER) scored.push({ row, score: s, at });
  });
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.at - b.at);
  const tied = scored.filter(x => x.score >= scored[0].score - 1e-9);
  const chosen = pick(tied);
  const others = scored.filter(x => x !== chosen && x.score >= Math.max(OFFER, chosen.score - 0.3)).slice(0, MAX_OTHERS);
  return { chosen, others };
}

const OTHER_KIND: Record<ItemKind, ItemKind> = { Goods: "Service", Service: "Goods" };

// Words that say the item is work that is done, not a thing that is supplied ("Painting Work", "Installation Charges"): Goods named like this get no code on their own
const SERVICE_WORDS = new Set(["work", "works", "service", "services", "labour", "labor", "installation", "charges", "charge", "erection", "maintenance", "repair", "repairs", "amc"]);
export const soundsLikeService = (name: string) => name.toLowerCase().split(/[^a-z]+/).some(w => SERVICE_WORDS.has(w));

// Is the match good enough to be put in the box? Good scores, and a clear lead over the codes of other headings (the heading and the sub-headings of one code do not compete).
function isConfident(chosen: Scored, others: Scored[]): boolean {
  if (chosen.score < FILL) return false;
  if (chosen.score >= SURE) return true;
  const family = chosen.row.entry.code.slice(0, 4);
  return !others.some(o => !o.row.entry.code.startsWith(family) && o.score > chosen.score - MARGIN);
}

// The code for an item name, and the nearest alternatives. `best` is only set when the match is good enough to put in the box without asking.
export function suggestCodes(name: string, kind: ItemKind): CodeSuggestions {
  const found = rank(name, kind);
  const asWork = kind === "Goods" && soundsLikeService(name);
  if (found && !asWork) return { best: suggestion(found.chosen), others: found.others.map(suggestion), switchTo: null };
  const near = found ? [found.chosen, ...found.others].slice(0, MAX_OTHERS).map(suggestion) : [];
  // Nothing fits as this kind: if the name is clearly an item of the other kind, say so (a Service whose name is a thing; Goods whose name is work done, or nothing at all as Goods)
  const elsewhere = rank(name, OTHER_KIND[kind]);
  const workLike = soundsLikeService(name);
  const rightKind = kind === "Service" ? !workLike : workLike || !found;
  const switchTo = elsewhere && rightKind ? { kind: OTHER_KIND[kind], best: suggestion(elsewhere.chosen) } : null;
  return { best: null, others: near, switchTo };
}
