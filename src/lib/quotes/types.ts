// Types and constants of the Quotes module, shared by the server and the browser. No server-only imports here.

import type { FileDto, ModuleLayoutDto, RecordRefs } from "@/lib/records/types";

// Draft -> (Mark as Sent) -> Sent -> (Mark as Accepted | Mark as Declined) -> Accepted | Declined; Invoiced comes from Convert to Invoice
export const QUOTE_STATUSES = ["Draft", "Sent", "Accepted", "Declined", "Invoiced"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const isQuoteStatus = (s: unknown): s is QuoteStatus => typeof s === "string" && (QUOTE_STATUSES as readonly string[]).includes(s);

// What "Mark as ..." may do from each status: the three-dot menu of a quote shows exactly these and the server allows exactly these
export const STATUS_ACTIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  Draft: ["Sent"],
  Sent: ["Accepted", "Declined"],
  Accepted: ["Declined"],
  Declined: ["Accepted"],
  Invoiced: [],
};

export const MAX_LINES = 200;
export const MAX_QUOTE_FILES = 5;

// ---------------------------------------------------------------------------
// Settings (Quote Settings: numbering, taxes, rounding, how amounts are shown, company details, messages)
// ---------------------------------------------------------------------------
export type TaxComponent = { name: string; rate: number }; // CGST9 (9%)
export type TaxDef = { id: string; name: string; rate: number; components: TaxComponent[]; active: boolean; isDefault?: boolean }; // GST18 = CGST9 + SGST9; the Default one is what a new item row starts with
export type WithholdingDef = { id: string; name: string; rate: number; active: boolean }; // a TDS section or a TCS rate

export type FyFormat = "YY-YY" | "YYYY-YY" | "YYYY-YYYY" | "YY" | "YYYY";
export const FY_FORMATS: FyFormat[] = ["YY-YY", "YYYY-YY", "YYYY-YYYY", "YY", "YYYY"];
export type NumberingSettings = {
  pattern: string; // QT/MSHS/{FY}/A/{SEQ}
  fyFormat: FyFormat;
  fyStartMonth: number; // 4 = April
  padding: number; // 0 = 723, 5 = 00723
  resetEachFy: boolean; // a new financial year starts a new series
  startNumber: number; // the first number of a series that has none yet
  allowManual: boolean; // the quote number can be typed on the form
};

export type RoundingMode = "nearest" | "up" | "down" | "none";
export const ROUNDING_MODES: { mode: RoundingMode; label: string }[] = [
  { mode: "nearest", label: "Round to the nearest rupee" },
  { mode: "up", label: "Always round up to the next rupee" },
  { mode: "down", label: "Always round down to the rupee" },
  { mode: "none", label: "Do not round" },
];

export type DisplaySettings = {
  currencySymbol: string; // Rs.
  grouping: "western" | "indian"; // 205,596.00 or 2,05,596.00
  wordsStyle: "international" | "indian"; // Thousand / Million or Thousand / Lakh / Crore
  wordsCurrency: string; // Indian Rupee
  documentTitle: string; // the big title of the quote document
};

export type CompanySettings = {
  name: string;
  registration: string; // a line under the company name, e.g. the company ID
  address: string; // lines
  gstin: string;
  phone: string;
  email: string;
  website: string;
  stateCode: string; // GST state code of the company ("33")
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankBranch: string;
  logoFileId: string | null; // a ModuleFile of the quotes settings
  signatureFileId: string | null; // authorised signature or seal
};

export type TemplateSettings = {
  emailSubject: string;
  emailBody: string;
  shareValidDays: number; // how long a shared link works
  defaultValidDays: number | null; // Expiry Date = Quote Date + this many days when a new quote is started
};

// Terms & Conditions templates of the quote form (the list behind the dropdown and the Settings window next to it). `configured` is false until a
// Super Admin has saved the list once: the form then offers the standard text of the layout as the only template.
export type TermsTemplate = { id: string; title: string; content: string };
export type TermsSettings = { configured: boolean; templates: TermsTemplate[] };

// The details printed in the two columns under the company block of the quote document (# / Quote Date ... Place Of Supply / Task Person).
// Which rows, their printed labels, their column and their order are set in Edit Page Layout. A row without a value on the quote is not printed.
export type HeaderKey = "number" | "date" | "expiry" | "reference" | "place" | "person" | "project" | "deal";
export const HEADER_KEYS: HeaderKey[] = ["number", "date", "expiry", "reference", "place", "person", "project", "deal"];
export const HEADER_NAMES: Record<HeaderKey, string> = {
  number: "Quote number",
  date: "Quote date",
  expiry: "Expiry date",
  reference: "Reference number",
  place: "Place of supply",
  person: "Task person",
  project: "Project",
  deal: "Deal",
};
export type HeaderRow = { key: HeaderKey; label: string; column: "left" | "right"; show: boolean };
export type DocumentSettings = { header: HeaderRow[] };

export type QuoteSettings = {
  numbering: NumberingSettings;
  taxes: TaxDef[];
  tds: WithholdingDef[];
  tcs: WithholdingDef[];
  rounding: { mode: RoundingMode };
  display: DisplaySettings;
  company: CompanySettings;
  templates: TemplateSettings;
  terms: TermsSettings;
  document: DocumentSettings;
};

// ---------------------------------------------------------------------------
// The totals of a quote: Item Subtotal -> Discount -> Tax -> Shipping -> TDS/TCS -> Adjustment -> Round Off -> Total
// ---------------------------------------------------------------------------
export type TaxInfo = { id: string; name: string; rate: number; components: TaxComponent[] };
export type Withholding = { kind: "TDS" | "TCS"; id: string; name: string; rate: number };
export type CalcLineIn = { quantity: number; rate: number; tax: TaxInfo | null };
export type CalcIn = {
  lines: CalcLineIn[];
  discountPercent: number;
  shipping: number;
  withholding: Withholding | null;
  adjustment: number;
  rounding: RoundingMode;
};
export type CalcLineOut = { amount: number; discount: number; taxable: number; tax: number };
export type TaxLineOut = { name: string; rate: number; amount: number };
export type CalcOut = {
  lines: CalcLineOut[];
  subTotal: number;
  discountAmount: number;
  taxableTotal: number;
  taxTotal: number;
  taxes: TaxLineOut[]; // CGST9 457.62, SGST9 457.62
  shipping: number;
  withholdingAmount: number; // minus for TDS, plus for TCS
  adjustment: number;
  roundOff: number;
  total: number;
};

// ---------------------------------------------------------------------------
// Items, customers
// ---------------------------------------------------------------------------
export type ItemDto = {
  id: string;
  name: string;
  description: string;
  hsn: string; // the HSN code of Goods, the SAC of a Service
  unit: string;
  rate: number;
  taxId: string | null; // the Intra State Tax Rate: the tax a row starts with when the quote is for the same state
  interTaxId: string | null; // the Inter State Tax Rate: the tax a row starts with when the quote is for another state
  kind: "Goods" | "Service";
  isActive: boolean;
  createdAt: string;
  category: string;
  sku: string;
  taxPreference: string; // an id of TAX_PREFERENCES
  taskTemplateId: string | null; // an option of the Template dropdown of the Project layout
  taskTemplateName: string;
  imageFileId: string | null; // the picture shown on a quote row: the front picture, or the first one there is
};

// The pictures of an item, by place; a saved one has a short-lived link
export type ItemImages = { front: FileDto[]; rear: FileDto[]; other: FileDto[] };

// An item as the New Item form edits it
export type ItemDetailDto = ItemDto & {
  unitGroup: string | null;
  identifiers: { type: string; value: string }[];
  trackInventory: boolean;
  inventoryTracking: string;
  inventoryAccount: string;
  valuationMethod: string;
  reorderPoint: number | null;
  returnable: boolean;
  brand: string;
  manufacturer: string;
  mrp: number | null;
  externalId: string | null; // the Item ID of the file the item was imported from
  extra: Record<string, string>; // the columns of that file that have no field of their own, as { "Column name": "value" }
  purchaseInfo: boolean; // Purchase Information is ticked: the four values below are kept
  costPrice: number | null;
  purchaseAccount: string;
  purchaseDescription: string;
  receivable: boolean;
  dimLength: number | null;
  dimWidth: number | null;
  dimHeight: number | null;
  dimUnit: string;
  weight: number | null;
  weightUnit: string;
  images: ItemImages;
};

// The HSN code / SAC that fits an item name (GET /api/quotes/items/suggest-code), see ./hsn-sac
export type CodeSuggestion = { code: string; description: string; score: number };
export type CodeSuggestions = {
  best: CodeSuggestion | null; // good enough to be put in the box; null when nothing fits well
  others: CodeSuggestion[]; // other codes worth a look (when best is null: the nearest ones)
  switchTo: { kind: "Goods" | "Service"; best: CodeSuggestion } | null; // nothing fits as this kind, but the name is clearly an item of the other kind
};

// A customer as the pick-lists, the quote form and the quote document use it. `address` is the Billing Address as printed lines; the new fields are
// empty for a customer that was added before the Customer form existed.
export type CustomerDto = {
  id: string;
  code: string | null;
  name: string; // the Display Name
  phone: string | null; // the Mobile
  email: string | null;
  address: string | null;
  gstin: string | null;
  customerType: string;
  companyName?: string | null;
  contactName?: string | null; // first name + last name
  shippingAddress?: string | null; // printed lines
  gstTreatment?: string | null;
  placeOfSupply?: string | null; // GST state code, 33 = Tamil Nadu
  pan?: string | null;
};

// ---------------------------------------------------------------------------
// A quote as the screens use it
// ---------------------------------------------------------------------------
export type LineInput = {
  id?: string;
  itemId?: string | null;
  name: string;
  description?: string;
  hsn?: string;
  kind?: "Goods" | "Service" | null;
  taskTemplateId?: string | null;
  unit?: string;
  quantity: number;
  rate: number;
  taxId?: string | null;
  custom?: Record<string, unknown>;
};

export type LineDto = {
  id: string;
  itemId: string | null;
  name: string;
  description: string;
  hsn: string;
  kind: "Goods" | "Service" | null; // decides whether hsn is an HSN code or a SAC
  taskTemplateId: string | null;
  taskTemplateName: string;
  imageFileId: string | null; // the picture of the item the line was made from (nothing for a line typed by hand)
  unit: string;
  quantity: number;
  rate: number;
  taxId: string | null;
  taxName: string | null;
  taxRate: number | null;
  amount: number; // quantity x rate
  custom: Record<string, unknown>;
};

export type CalcInput = {
  discountPercent: number | null;
  shippingCharges: number | null;
  withholding: { kind: "TDS" | "TCS"; taxId: string } | null;
  adjustmentLabel: string | null;
  adjustment: number | null;
};

export type QuoteBody = {
  values: Record<string, unknown>; // header fields, by key of the layout
  lines: LineInput[];
  calc: CalcInput;
  intent: "draft" | "save" | "send"; // Save as Draft, Save, Save and Send
  profitPercent?: number | string | null; // Upload Vendor Quote: the markup on the vendor rates of the lines that came from a vendor quote (null = none)
  draftId?: string | null; // a new quote: the quote in progress (auto-save) this Save turns into the quote; it keeps the number it reserved
  force?: boolean; // a saved quote: save although it was changed by someone else after this editing started
};

export type ShareInfo = { token: string | null; url: string | null; expiresAt: string | null };

export type ActivityDto = { id: string; action: string; text: string; by: string | null; at: string };

export type QuoteDto = {
  id: string;
  quoteNumber: string;
  numberSeries: string | null;
  numberSeq: number | null;
  status: string;
  values: Record<string, unknown>; // by key of the layout: a day is YYYY-MM-DD, files are FileDto[]
  lines: LineDto[];
  calc: { discountPercent: number; shippingCharges: number; withholding: { kind: "TDS" | "TCS"; taxId: string; name: string; rate: number } | null; adjustmentLabel: string; adjustment: number };
  totals: CalcOut;
  profitPercent: number | null; // see QuoteBody
  refs: RecordRefs;
  customer: CustomerDto | null;
  files: FileDto[];
  share: ShareInfo;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuoteListRow = {
  id: string;
  number: string;
  customer: string;
  status: string;
  total: number;
  date: string; // YYYY-MM-DD
  reference: string;
  cells: Record<string, string>; // every column of the layout, as text
};

export type QuoteListData = {
  rows: QuoteListRow[];
  total: number;
  showing: number;
  page: number;
  pageCount: number;
  pageSize: number;
  statusCounts: Record<string, number>;
};

export type QuoteListParams = {
  q?: string;
  status?: QuoteStatus;
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
  customer?: string;
  from?: string;
  to?: string;
};

export type QuoteAbilities = { create: boolean; edit: boolean; delete: boolean; export: boolean; layout: boolean; settings: boolean };

// What a screen needs to draw a quote form
export type QuoteFormContext = {
  layout: ModuleLayoutDto;
  settings: QuoteSettings;
  nextNumber: string;
  me: { id: string; name: string } | null;
};
