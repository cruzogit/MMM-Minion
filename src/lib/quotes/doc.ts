// The quote as a printed document: the Quote Details page, the print / PDF page and the page a customer opens with the share link all draw
// this one model. Everything on it comes from the saved quote, Quote Settings (company, bank, title, how amounts look, the rows under the
// company block) and the layout (a field or column that was switched off in Edit Page Layout is not printed; the ones added there are).

import { GST_STATES } from "@/lib/records/registry";
import { displayValue, isEmptyValue } from "@/lib/records/values";
import type { LayoutField, ModuleLayoutDto } from "@/lib/records/types";
import { amountInWords, formatQuoteDay, type Grouping } from "./format";
import { taxCodeShort } from "./item-constants";
import type { CalcOut, HeaderKey, QuoteDto, QuoteSettings } from "./types";

export type DocLine = {
  no: number | null;
  isHeader: boolean;
  name: string;
  description: string;
  hsn: string;
  taxCodeLabel: string; // HSN for Goods, SAC for a Service
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
  taxName: string; // "GST18"
  taxRate: number | null;
  extra: Record<string, string>; // the columns added in Edit Page Layout
};

export type DocCompany = {
  name: string;
  registration: string;
  address: string[];
  gstin: string;
  phone: string;
  email: string;
  website: string;
  logo: string | null;
  signature: string | null;
  bank: { label: string; value: string }[]; // empty when no bank details are set
};

export type DocHeaderRow = { label: string; value: string };

export type QuoteDoc = {
  id: string;
  title: string; // PERFORMA INVOICE
  status: string;
  number: string;
  company: DocCompany;
  headerLeft: DocHeaderRow[]; // the rows under the company block: # / Quote Date ... | Place Of Supply / Task Person ...
  headerRight: DocHeaderRow[];
  customer: { name: string; address: string[]; shipTo: string[]; gstin: string; phone: string; email: string };
  subject: string;
  extraColumns: { key: string; label: string }[];
  showHsn: boolean;
  showUnit: boolean;
  showTax: boolean;
  lines: DocLine[];
  calc: QuoteDto["calc"];
  totals: CalcOut;
  words: string;
  notes: string;
  terms: string;
  currency: { symbol: string; grouping: Grouping };
};

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const lines = (v: string | null | undefined): string[] => (v ?? "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);

// "Tamil Nadu (33)" for the code 33; the first two digits of a GSTIN are the state of the customer
export function stateLabel(code: string): string {
  const hit = GST_STATES.find(([c]) => c === code);
  return hit ? `${hit[1]} (${hit[0]})` : "";
}

const FORM_ONLY = new Set(["FILE", "CALC", "AUTO"]);

export function buildDoc(quote: QuoteDto, layout: ModuleLayoutDto, settings: QuoteSettings, images: { logo: string | null; signature: string | null }): QuoteDoc {
  const formSections = new Set(layout.sections.filter(s => s.kind === "FORM").map(s => s.id));
  const field = (key: string): LayoutField | undefined => layout.fields.find(f => f.key === key);
  const on = (key: string) => field(key)?.enabled !== false; // a field that is switched off is not printed
  const v = quote.values;
  const c = settings.company;
  const customer = quote.customer;

  const salespersonId = text(v.salespersonId);
  const projectId = text(v.projectId);
  const dealId = text(v.dealId);
  const deal = dealId ? quote.refs.deals[dealId] : undefined;

  // Place of supply: what the quote says, else the one saved with the customer, else the state of the customer's GSTIN, else the company's own state
  const gstin = text(v.customerGstin) || customer?.gstin || "";
  const placeCode = text(v.placeOfSupply) || customer?.placeOfSupply || (/^\d{2}/.test(gstin) ? gstin.slice(0, 2) : "") || c.stateCode;

  // The value of each row that can sit under the company block (empty = nothing to print)
  const value: Record<HeaderKey, string> = {
    number: quote.quoteNumber,
    date: formatQuoteDay(text(v.date)),
    expiry: on("expiryDate") ? formatQuoteDay(text(v.expiryDate)) : "",
    reference: on("reference") ? text(v.reference) : "",
    place: placeCode ? stateLabel(placeCode) : "",
    person: on("salespersonId") && salespersonId ? quote.refs.users[salespersonId] ?? "" : "",
    project: on("projectId") && projectId ? quote.refs.lookups?.project?.[projectId] ?? "" : "",
    deal: on("dealId") && deal ? (deal.name ? `${deal.code} - ${deal.name}` : deal.code) : "",
  };
  const rows = (column: "left" | "right"): DocHeaderRow[] =>
    settings.document.header.filter(r => r.show && r.column === column && value[r.key]).map(r => ({ label: r.label, value: value[r.key] }));
  const headerRight = rows("right");

  // The fields added in Edit Page Layout follow the standard ones in the right column
  for (const f of layout.fields) {
    if (f.isSystem || !f.enabled || !formSections.has(f.section) || FORM_ONLY.has(f.type)) continue;
    const raw = v[f.key];
    if (isEmptyValue(raw)) continue;
    const shown = displayValue(f, raw, quote.refs);
    if (shown) headerRight.push({ label: f.label, value: shown });
  }

  const itemFields = layout.fields.filter(f => f.section === "items");
  const itemOn = (key: string) => itemFields.find(f => f.key === key)?.enabled !== false;
  const extraColumns = itemFields.filter(f => !f.isSystem && f.enabled && f.type !== "FILE").map(f => ({ key: f.key, label: f.label }));
  const columnOf = (key: string) => itemFields.find(f => f.key === key);

  let lineNo = 0;
  const docLines: DocLine[] = quote.lines.map(l => {
    const isHeader = l.custom?.isHeader === true;
    return {
      no: isHeader ? null : ++lineNo,
      isHeader,
      name: l.name,
      description: l.description,
      hsn: l.hsn,
      taxCodeLabel: taxCodeShort(l.kind),
      unit: l.unit,
      quantity: l.quantity,
      rate: l.rate,
      amount: l.amount,
      taxName: l.taxName ?? "",
      taxRate: l.taxRate,
      extra: Object.fromEntries(extraColumns.map(col => {
        const f = columnOf(col.key);
        return [col.key, f ? displayValue(f, l.custom[col.key], quote.refs) : ""];
      })),
    };
  });

  const bank = [
    ["Bank Name", c.bankName], ["Account Holder", c.bankAccountHolder], ["A/c No.", c.bankAccountNumber], ["IFSC Code", c.bankIfsc], ["Branch", c.bankBranch],
  ].filter(([, value]) => !!value).map(([label, value]) => ({ label, value }));

  return {
    id: quote.id,
    title: settings.display.documentTitle,
    status: quote.status,
    number: quote.quoteNumber,
    company: {
      name: c.name, registration: c.registration, address: lines(c.address), gstin: c.gstin, phone: c.phone, email: c.email, website: c.website,
      logo: images.logo, signature: images.signature, bank,
    },
    headerLeft: rows("left"),
    headerRight,
    customer: {
      name: customer?.name ?? "",
      address: lines(text(v.billingAddress) || customer?.address),
      shipTo: lines(customer?.shippingAddress),
      gstin,
      phone: customer?.phone ?? "",
      email: customer?.email ?? "",
    },
    subject: on("subject") ? text(v.subject) : "",
    extraColumns,
    showHsn: itemOn("hsn") && quote.lines.some(l => l.hsn),
    showUnit: itemOn("unit") && quote.lines.some(l => l.unit),
    showTax: itemOn("taxId"),
    lines: docLines,
    calc: quote.calc,
    totals: quote.totals,
    words: amountInWords(quote.totals.total, settings.display.wordsCurrency, settings.display.wordsStyle),
    notes: on("notes") ? text(v.notes) : "",
    terms: on("terms") ? text(v.terms) : "",
    currency: { symbol: settings.display.currencySymbol, grouping: settings.display.grouping },
  };
}
