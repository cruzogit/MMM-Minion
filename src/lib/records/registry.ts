// The four record modules and their standard fields (the layout every module starts with before anyone edits it).
// Shared by the server and the browser: no server-only imports.

import type { ModuleKey } from "@/lib/rbac/catalog";
import type { FieldOption, FieldType, LookupKind, ModuleId } from "./types";
import {
  ACCOUNTS_RECEIVABLE, COUNTRIES, CURRENCIES, CUSTOMER_COUNTER, CUSTOMER_TYPES, DEFAULT_COUNTRY, DEFAULT_CURRENCY, DEFAULT_LANGUAGE, DEFAULT_PAYMENT_TERMS,
  GST_STATE_ABBR, LANGUAGES, PAYMENT_TERMS, SALUTATIONS, TAX_PREFERENCES,
} from "../customers/constants";
import { GST_TREATMENTS } from "../customers/gst";
import { ITEM_IMAGE_FIELDS, MAX_OTHER_IMAGES } from "../quotes/item-constants";

export type SystemField = {
  key: string; // the column name (File Upload fields have no column: their files are in ModuleFile)
  label: string;
  type: FieldType;
  section: string;
  required?: boolean;
  requiredLocked?: boolean; // cannot be made optional or hidden
  readOnly?: boolean;
  listed?: boolean; // starts as a column of the list page
  hidden?: boolean; // starts hidden (a Super Admin can show it in Edit Page Layout)
  notListable?: boolean; // can never be a column of the list page
  options?: FieldOption[]; // the starting choices of a dropdown
  default?: string; // option id, "@me", "@today", or a literal
  lookup?: LookupKind;
  relation?: string; // the Prisma relation behind a user / deal / vendor field
  prefix?: string;
  max?: number;
  integer?: boolean;
  min?: number;
  maxFiles?: number;
};

export type TableDef = {
  section: string; // the id of the section that shows it
  relation: string; // name of the list of rows on the record
  model: string; // Prisma delegate of the rows
  table: string; // its SQL table
  fields: SystemField[];
  parentKey?: string; // the column of a row that points to its record (default vendorId)
  parentRelation?: string; // the relation of a row to its record (default vendor)
};

export type ModuleDef = {
  id: ModuleId;
  slug: string; // the address: /<slug>
  label: string; // Material Vendor
  plural: string;
  heading: string; // title of the list page
  createLabel: string; // + Create Material Vendor
  idPrefix: string;
  idLabel: string; // the ID column, when the form has no ID field of its own
  counterKey: string;
  permission: ModuleKey; // the role permissions that guard it (view / create / edit / delete / export / approve)
  model: string; // Prisma delegate
  table: string; // its SQL table
  entityType: string; // in the activity log
  nameKey: string; // the field that names a record in lookups ("Material Company Name")
  sections: { id: string; label: string; kind: "FORM" | "TABLE" | "FIXED" }[];
  fields: SystemField[];
  tables: TableDef[];
  hasApproval: boolean;
  custom?: boolean; // has its own screens and service (Quotes): the generic record pages and API do not apply
  allowLookupFields?: boolean; // New Field can add a Lookup
  allowMultiSelect?: boolean; // New Field can add a Multi-select (several choices from a list)
  hardRecords?: boolean; // the table has no deletedAt column: records are never soft-deleted (Customers)
  defaultColumns?: string[]; // the list columns a module starts with, in order (default: the listed fields, in form order)
};

// "Between 300-500" -> "between_300_500"; the same label twice gets _2, _3, ...
function ids(labels: string[]): FieldOption[] {
  const seen = new Map<string, number>();
  return labels.map(label => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "option";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { id: n === 1 ? base : `${base}_${n}`, label };
  });
}
const optionId = (label: string) => ids([label])[0].id;

const STATES = [
  "AN - Andaman and Nicobar Islands", "AP - Andhra Pradesh", "AR - Arunachal Pradesh", "AS - Assam", "BR - Bihar", "CH - Chandigarh",
  "CG - Chhattisgarh", "DN - Dadra and Nagar Haveli and Daman and Diu", "DL - Delhi", "GA - Goa", "GJ - Gujarat", "HR - Haryana",
  "HP - Himachal Pradesh", "JK - Jammu and Kashmir", "JH - Jharkhand", "KA - Karnataka", "KL - Kerala", "LA - Ladakh", "LD - Lakshadweep",
  "MP - Madhya Pradesh", "MH - Maharashtra", "MN - Manipur", "ML - Meghalaya", "MZ - Mizoram", "NL - Nagaland", "OD - Odisha",
  "PY - Puducherry", "PB - Punjab", "RJ - Rajasthan", "SK - Sikkim", "TN - Tamil Nadu", "TS - Telangana", "TR - Tripura",
  "UP - Uttar Pradesh", "UK - Uttarakhand", "WB - West Bengal",
];

const RATING = ids(["1 Star", "2 Star", "3 Star", "4 Star", "5 Star"]);
const CURRENCY = ids(["INR", "USD", "EUR", "GBP", "AED", "SGD"]);

// ---------------------------------------------------------------------------
// Material Vendor
// ---------------------------------------------------------------------------
const MATERIAL_VENDOR: ModuleDef = {
  id: "materialVendor",
  slug: "material-vendors",
  label: "Material Vendor",
  plural: "Material Vendors",
  heading: "Material Vendor Management",
  createLabel: "Create Material Vendor",
  idPrefix: "MV",
  idLabel: "Material Vendor ID",
  counterKey: "materialVendor",
  permission: "vendors",
  model: "materialVendor",
  table: "MaterialVendor",
  entityType: "MaterialVendor",
  nameKey: "companyName",
  hasApproval: false,
  sections: [
    { id: "info", label: "Material Vendor Information", kind: "FORM" },
    { id: "prices", label: "Price Detail", kind: "TABLE" },
  ],
  fields: [
    // left column
    { key: "companyName", label: "Material Company Name", type: "TEXT", section: "info", required: true, requiredLocked: true, listed: true, max: 200 },
    { key: "phone1", label: "Phone 1", type: "PHONE", section: "info", listed: true },
    { key: "phone2", label: "Phone 2", type: "PHONE", section: "info" },
    { key: "address", label: "Address", type: "TEXTAREA", section: "info", max: 1000 },
    { key: "city", label: "City", type: "TEXT", section: "info", listed: true, max: 100 },
    { key: "vendorType", label: "Vendor Type", type: "DROPDOWN", section: "info", listed: true, options: ids(["Manufacturer", "Distributor", "Dealer", "Retailer", "Wholesaler", "Trader"]) },
    { key: "shopType", label: "Shop Type", type: "DROPDOWN", section: "info", listed: true, options: ids(["Retail Shop", "Wholesale Shop", "Warehouse", "Showroom", "Online Store", "Factory"]) },
    { key: "taskPersonId", label: "Task Person", type: "USER", section: "info", listed: true, default: "@me", relation: "taskPerson" },
    { key: "email", label: "Email", type: "EMAIL", section: "info", listed: true },
    { key: "exchangeRate", label: "Exchange Rate", type: "NUMBER", section: "info", readOnly: true, default: "1", min: 0 },
    // right column
    { key: "ownerId", label: "Categories Owner", type: "USER", section: "info", default: "@me", relation: "owner" },
    { key: "price", label: "Price", type: "CURRENCY", section: "info", prefix: "Rs." },
    { key: "rating", label: "Rating", type: "DROPDOWN", section: "info", listed: true, options: RATING },
    {
      key: "subCategory", label: "Sub Category", type: "DROPDOWN", section: "info",
      options: ids(["Switches and Sockets", "Wires and Cables", "Conduits and Pipes", "Fittings", "Lights and Fixtures", "Sensors", "Panels and Boards", "Other"]),
    },
    {
      key: "category", label: "Category", type: "DROPDOWN", section: "info", listed: true,
      options: ids(["Electrical", "Plumbing", "Hardware", "Paints", "Tiles and Flooring", "Wood and Plywood", "Glass and Aluminium", "Automation Products", "Cables and Wires", "Lighting", "Other"]),
    },
    { key: "description", label: "Description", type: "TEXT", section: "info", max: 1000 },
    { key: "products", label: "Products", type: "TEXT", section: "info", max: 1000 },
    { key: "currency", label: "Currency", type: "DROPDOWN", section: "info", options: CURRENCY, default: "inr" },
    { key: "gstNumber", label: "GST Registration Number", type: "TEXT", section: "info", max: 30 },
    { key: "sourceOfSupply", label: "Source of Supply", type: "DROPDOWN", section: "info", options: ids(STATES), default: optionId("TN - Tamil Nadu") },
  ],
  tables: [
    {
      section: "prices",
      relation: "prices",
      model: "materialVendorPrice",
      table: "MaterialVendorPrice",
      fields: [
        { key: "materialName", label: "Material Name", type: "TEXT", section: "prices", max: 200 },
        { key: "unit", label: "Unit", type: "DROPDOWN", section: "prices", options: ids(["Nos", "Kg", "Gram", "Ton", "Meter", "Running Ft", "Sq.Ft", "Sq.M", "Litre", "Box", "Bag", "Set", "Roll", "Sheet", "Pair"]) },
        { key: "rate", label: "Rate (Rs.)", type: "CURRENCY", section: "prices", prefix: "" },
        { key: "uploadFiles", label: "Upload Files", type: "FILE", section: "prices", maxFiles: 5 },
        { key: "size", label: "Size", type: "TEXT", section: "prices", max: 100 },
        { key: "thickness", label: "Thickness", type: "TEXT", section: "prices", max: 100 },
        { key: "note", label: "Note", type: "TEXT", section: "prices", max: 500 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Service Vendor
// ---------------------------------------------------------------------------
const SERVICE_VENDOR: ModuleDef = {
  id: "serviceVendor",
  slug: "service-vendors",
  label: "Service Vendor",
  plural: "Service Vendors",
  heading: "Service Vendor Management",
  createLabel: "Create Service Vendor",
  idPrefix: "SV",
  idLabel: "Service Vendor ID",
  counterKey: "serviceVendor",
  permission: "vendors",
  model: "serviceVendor",
  table: "ServiceVendor",
  entityType: "ServiceVendor",
  nameKey: "name",
  hasApproval: false,
  sections: [
    { id: "info", label: "Service Vendor Information", kind: "FORM" },
    { id: "prices", label: "Price Detail", kind: "TABLE" },
    { id: "remarks", label: "Remarks", kind: "TABLE" },
  ],
  fields: [
    // left column
    { key: "name", label: "Service Vendor Name", type: "TEXT", section: "info", required: true, requiredLocked: true, listed: true, max: 200 },
    { key: "nickName", label: "Nick Name", type: "TEXT", section: "info", max: 100 },
    { key: "phone1", label: "Phone 1", type: "PHONE", section: "info", required: true, listed: true },
    { key: "phone2", label: "Phone 2", type: "PHONE", section: "info", required: true },
    { key: "email", label: "Email", type: "EMAIL", section: "info" },
    { key: "address", label: "Address", type: "TEXTAREA", section: "info", max: 1000 },
    { key: "city", label: "City", type: "TEXT", section: "info", required: true, listed: true, max: 100 },
    { key: "vendorType", label: "Vendor Type", type: "DROPDOWN", section: "info", required: true, listed: true, options: ids(["Individual", "Contractor", "Company", "Agency", "Freelancer"]) },
    { key: "serviceLocation", label: "Service Location", type: "TEXTAREA", section: "info", required: true, max: 1000 },
    { key: "taskPersonId", label: "Task Person", type: "USER", section: "info", required: true, listed: true, default: "@me", relation: "taskPerson" },
    { key: "companyName", label: "Company Name", type: "TEXT", section: "info", max: 200 },
    { key: "gstCertificate", label: "GST or Incorporation Certificate", type: "FILE", section: "info", maxFiles: 3 },
    { key: "exchangeRate", label: "Exchange Rate", type: "NUMBER", section: "info", readOnly: true, default: "1", min: 0 },
    // right column
    { key: "ownerId", label: "Vendor Catalogue Owner", type: "USER", section: "info", default: "@me", relation: "owner" },
    { key: "status", label: "Status", type: "DROPDOWN", section: "info", listed: true, options: ids(["Active", "Inactive", "On Hold", "Blacklisted"]), default: "active" },
    {
      key: "serviceCategory", label: "Service Category", type: "DROPDOWN", section: "info", required: true, listed: true,
      options: ids(["Electrical", "Plumbing", "Carpentry", "Painting", "Civil Work", "False Ceiling", "Flooring and Tiling", "Automation / Smart Home", "Landscaping", "Interior Works", "Other"]),
    },
    { key: "serviceType", label: "Service Type", type: "DROPDOWN", section: "info", required: true, listed: true, options: ids(["Service Only", "Service with Material"]), default: "service_only" },
    { key: "rating", label: "Rating", type: "DROPDOWN", section: "info", listed: true, options: RATING, default: "3_star" },
    { key: "source", label: "Source", type: "DROPDOWN", section: "info", required: true, options: ids(["Reference", "Existing Vendor", "Online Search", "IndiaMART", "Social Media", "Walk-in", "Other"]) },
    { key: "category", label: "Category", type: "DROPDOWN", section: "info", required: true, options: ids(["Contractor", "Sub-contractor", "Labour Supplier", "Consultant", "Other"]) },
    { key: "labourCount", label: "Labour Count", type: "NUMBER", section: "info", required: true, integer: true, min: 0 },
    { key: "projectDriveLink", label: "Project Drive Link", type: "URL", section: "info" },
    { key: "bankDocument", label: "Bank Passbook / Cheque Leaf", type: "FILE", section: "info", maxFiles: 3 },
    { key: "panCard", label: "PAN Card", type: "FILE", section: "info", maxFiles: 3 },
    { key: "aadhaarCard", label: "Aadhaar Card", type: "FILE", section: "info", maxFiles: 3 },
    { key: "currency", label: "Currency", type: "DROPDOWN", section: "info", options: CURRENCY, default: "inr" },
  ],
  tables: [
    {
      section: "prices",
      relation: "prices",
      model: "serviceVendorPrice",
      table: "ServiceVendorPrice",
      fields: [
        { key: "serviceName", label: "Service Name", type: "TEXTAREA", section: "prices", max: 500 },
        { key: "unit", label: "Unit", type: "DROPDOWN", section: "prices", options: ids(["Sq.Ft", "Running Ft", "Sq.M", "Nos", "Point", "Day", "Hour", "Visit", "Lump Sum", "Meter"]) },
        { key: "rate", label: "Rate (Rs.)", type: "CURRENCY", section: "prices", prefix: "" },
        { key: "areaRange", label: "Area Range", type: "DROPDOWN", section: "prices", options: ids(["Below 100", "Between 100-300", "Between 300-500", "Between 500-1000", "Above 1000"]) },
      ],
    },
    {
      section: "remarks",
      relation: "remarks",
      model: "serviceVendorRemark",
      table: "ServiceVendorRemark",
      fields: [{ key: "workRemarks", label: "Remarks of Work", type: "TEXTAREA", section: "remarks", max: 5000 }],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pre-Payment Records and Payment Collection Records: the same form, named for what they are
// ---------------------------------------------------------------------------
function paymentModule(kind: "pre" | "collection"): ModuleDef {
  const pre = kind === "pre";
  const noun = pre ? "Payment" : "Collection";
  return {
    id: pre ? "prePayment" : "paymentCollection",
    slug: pre ? "pre-payments" : "payment-collections",
    label: pre ? "Pre-Payment" : "Payment Collection",
    plural: pre ? "Pre-Payment Records" : "Payment Collection Records",
    heading: pre ? "Pre-Payment Records" : "Payment Collection Records",
    createLabel: pre ? "Create Pre-Payment" : "Create Payment Collection",
    idPrefix: pre ? "PPR" : "PCR",
    idLabel: `${noun} ID`,
    counterKey: pre ? "prePayment" : "paymentCollection",
    permission: pre ? "ppr" : "payments",
    model: pre ? "prePayment" : "paymentCollection",
    table: pre ? "PrePayment" : "PaymentCollection",
    entityType: pre ? "PrePayment" : "PaymentCollection",
    nameKey: "code",
    hasApproval: true,
    sections: [{ id: "info", label: pre ? "Pre-Payment Information" : "Payment Collection Information", kind: "FORM" }],
    fields: [
      // left column
      { key: "code", label: `${noun} ID`, type: "AUTO", section: "info", required: true, requiredLocked: true, readOnly: true },
      { key: "dealId", label: "Deals ID", type: "LOOKUP", section: "info", required: true, listed: true, lookup: "deal", relation: "deal" },
      { key: "taskPersonId", label: "Task Person", type: "USER", section: "info", required: true, listed: true, default: "@me", relation: "taskPerson" },
      {
        key: "paymentMode", label: `${noun} Mode`, type: "DROPDOWN", section: "info", required: true, listed: true,
        options: ids(["DBS - MINION", "Cash", "UPI", "Cheque", "NEFT / RTGS / IMPS", "Credit Card", "Other"]), default: "dbs_minion",
      },
      {
        key: "paymentType", label: `${noun} Type`, type: "DROPDOWN", section: "info", required: true, listed: true,
        options: ids(pre ? ["Advance", "Material Payment", "Service Payment", "Labour Payment", "Transport", "Other"] : ["Advance", "Part Payment", "Final Payment", "Retention Release", "Other"]),
      },
      { key: "materialVendorId", label: "Material Vendor Name", type: "LOOKUP", section: "info", listed: true, lookup: "materialVendor", relation: "materialVendor" },
      { key: "serviceVendorId", label: "Service Vendor Name", type: "LOOKUP", section: "info", listed: true, lookup: "serviceVendor", relation: "serviceVendor" },
      // Pre-Payment only: which project template (Gypsum False Ceiling, Painting ...) the money was spent on. A project's Work Coverage adds up the amounts by it.
      ...(pre ? [{ key: "workTypeId", label: "Work Type", type: "LOOKUP", section: "info", lookup: "template" } satisfies SystemField] : []),
      { key: "amount", label: "Amount", type: "CURRENCY", section: "info", required: true, listed: true, prefix: "INR" },
      // right column
      { key: "date", label: "Date", type: "DATE", section: "info", required: true, listed: true, default: "@today" },
      {
        key: "paymentStatus", label: `${noun} Status`, type: "DROPDOWN", section: "info", required: true, listed: true,
        options: ids(["Pending Approval", "Approved", pre ? "Paid" : "Collected", "Rejected", "Cancelled"]), default: "pending_approval",
      },
      { key: "utrDate", label: "UTR Transaction Date", type: "DATE", section: "info", default: "@today" },
      { key: "utrNumber", label: "UTR / Transaction No", type: "TEXTAREA", section: "info", max: 36000 },
      { key: "remarks", label: "Remarks", type: "TEXTAREA", section: "info", required: true, max: 36000 },
      { key: "attachment", label: "Attachment", type: "FILE", section: "info", maxFiles: 3 },
      { key: "approvedById", label: "Approved By", type: "APPROVER", section: "info", required: true, listed: true, relation: "approvedBy" },
    ],
    tables: [],
  };
}

// ---------------------------------------------------------------------------
// Quote: the Zoho Books quote form. Its screens, numbering and totals are in src/lib/quotes and src/app/quotes; this definition is what
// Edit Page Layout works on: labels, mandatory, hidden, order, sections, new fields, dropdown options, the item table's columns.
// ---------------------------------------------------------------------------
export const GST_STATES: [string, string][] = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
  ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"],
  ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"],
  ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"],
  ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"],
  ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"],
  ["37", "Andhra Pradesh"], ["38", "Ladakh"],
];
export const gstStateOptions = (): FieldOption[] => GST_STATES.map(([code, name]) => ({ id: code, label: `${name} (${code})` }));

const QUOTE: ModuleDef = {
  id: "quote",
  slug: "quotes",
  label: "Quote",
  plural: "Quotes",
  heading: "All Quotes",
  createLabel: "New",
  idPrefix: "QT",
  idLabel: "Quote Number",
  counterKey: "quote",
  permission: "quotes",
  model: "quote",
  table: "Quote",
  entityType: "Quote",
  nameKey: "quoteNumber",
  hasApproval: false,
  custom: true,
  allowLookupFields: true,
  defaultColumns: ["date", "quoteNumber", "reference", "customerId", "status", "amount"],
  sections: [
    { id: "customer", label: "Customer", kind: "FORM" },
    { id: "details", label: "Quote Details", kind: "FORM" },
    { id: "sales", label: "Sales", kind: "FORM" },
    { id: "subject", label: "Subject", kind: "FORM" },
    { id: "items", label: "Item Table", kind: "TABLE" },
    { id: "calc", label: "Calculation", kind: "FIXED" },
    { id: "notes", label: "Customer Notes", kind: "FORM" },
    { id: "terms", label: "Terms & Attachments", kind: "FORM" },
    { id: "list", label: "Shown on the quote list and the quote page", kind: "FIXED" },
  ],
  fields: [
    { key: "customerId", label: "Customer Name", type: "LOOKUP", section: "customer", required: true, requiredLocked: true, listed: true, lookup: "customer", relation: "customer" },
    // what the quote document prints about the customer: filled from the customer, editable per quote when shown
    { key: "billingAddress", label: "Billing Address", type: "TEXTAREA", section: "customer", hidden: true, max: 1000 },
    { key: "customerGstin", label: "Customer GSTIN", type: "TEXT", section: "customer", hidden: true, max: 30 },
    { key: "placeOfSupply", label: "Place of Supply", type: "DROPDOWN", section: "customer", hidden: true, options: gstStateOptions() },
    { key: "quoteNumber", label: "Quote#", type: "AUTO", section: "details", required: true, requiredLocked: true, readOnly: true, listed: true },
    { key: "reference", label: "Reference#", type: "TEXT", section: "details", listed: true, max: 100 },
    { key: "date", label: "Quote Date", type: "DATE", section: "details", required: true, requiredLocked: true, listed: true, default: "@today" },
    { key: "expiryDate", label: "Expiry Date", type: "DATE", section: "details" },
    { key: "salespersonId", label: "Task Person", type: "USER", section: "sales", required: true, default: "@me", relation: "salesperson" },
    { key: "projectId", label: "Project Name", type: "LOOKUP", section: "sales", lookup: "project", relation: "project" },
    { key: "dealId", label: "Deal Name", type: "LOOKUP", section: "sales", lookup: "deal", relation: "deal" },
    { key: "projectLocation", label: "Project Location", type: "TEXTAREA", section: "sales", hidden: true, max: 1000 },
    { key: "subject", label: "Subject", type: "TEXTAREA", section: "subject", max: 2000 },
    // the calculation panel (placed by the quote form itself)
    { key: "discountPercent", label: "Discount", type: "CALC", section: "calc", notListable: true },
    { key: "shippingCharges", label: "Shipping Charges", type: "CALC", section: "calc", notListable: true },
    { key: "tdsTcsKind", label: "TDS / TCS", type: "CALC", section: "calc", notListable: true },
    { key: "adjustment", label: "Adjustment", type: "CALC", section: "calc", notListable: true },
    { key: "roundOff", label: "Round Off", type: "CALC", section: "calc", notListable: true },
    { key: "notes", label: "Customer Notes", type: "TEXTAREA", section: "notes", default: "Looking forward to your business.", max: 5000 },
    { key: "terms", label: "Terms & Conditions", type: "TEXTAREA", section: "terms", max: 10000 },
    { key: "attachments", label: "Attach File(s) to Quote", type: "FILE", section: "terms", maxFiles: 5 },
    { key: "retainerInvoice", label: "Create a retainer invoice for this quote automatically", type: "CHECKBOX", section: "terms" },
    // worked out by the system
    { key: "status", label: "Quote Status", type: "CALC", section: "list", listed: true },
    { key: "amount", label: "Total", type: "CALC", section: "list", listed: true },
  ],
  tables: [
    {
      section: "items",
      relation: "lineItems",
      model: "quoteItem",
      table: "QuoteItem",
      parentKey: "quoteId",
      parentRelation: "quote",
      fields: [
        { key: "name", label: "Item Details", type: "LOOKUP", section: "items", required: true, requiredLocked: true, lookup: "item" },
        { key: "taskTemplateId", label: "Task Template", type: "LOOKUP", section: "items", lookup: "template" },
        { key: "hsn", label: "HSN/SAC", type: "TEXT", section: "items", hidden: true, max: 20 },
        { key: "unit", label: "Unit", type: "TEXT", section: "items", hidden: true, max: 20 },
        { key: "quantity", label: "Quantity", type: "NUMBER", section: "items", required: true, requiredLocked: true, default: "1", min: 0 },
        { key: "rate", label: "Rate", type: "CURRENCY", section: "items", prefix: "" },
        { key: "taxId", label: "Tax", type: "LOOKUP", section: "items", lookup: "tax" },
        { key: "lineAmount", label: "Amount", type: "CALC", section: "items", readOnly: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Project: a deal converted with Convert to Project. Its screens, numbering (MP1, MP2 ...) and calculations are in src/lib/projects and
// src/app/projects; this definition is what Edit Page Layout works on: the labels, mandatory, hidden, order and added fields of the project
// header, the financial inputs and every template table, plus the dropdown choices (Project Status, Template, Material Status).
//   FORM  fields are columns of "Project" (or its customFields)
//   TABLE rows are kept in a Project* table (a column's key is the column name); a column of kind CALC is worked out from other records
//   FIXED the section shows records of other modules (Payment Collection, Site Expenses, Tasks) or worked-out numbers: its columns can be
//         renamed and hidden, but nothing is added there (new fields for those records belong to their own module's layout)
// Every key is unique across the whole module (the layout is one list), so a table's column is named for its table (materialCode,
// serviceStartDate ...). No field is a list column: the Projects page has its own columns; a field added in the Project section can be one.
// ---------------------------------------------------------------------------
export const PROJECT_TEMPLATE_FIELD = "templateId"; // the Template dropdown: its choices are the list of project templates (also offered as the Work Type of a PPR)
const PROJECT_TEMPLATES = ids([
  "Gypsum False Ceiling", "PVC False Ceiling", "Wooden False Ceiling", "Carpentry", "Wardrobe", "Electrical", "Painting", "Flooring", "Wall Cladding",
  "Modular Furniture", "Plumbing", "Glass Work", "Aluminium Work", "Landscaping", "Automation", "CCTV", "Smart Home Automation", "Interior Works", "Exterior Works",
]);
export const PROJECT_PRODUCT_OR_SERVICE: FieldOption[] = [{ id: "lo_pos_product", label: "Product" }, { id: "lo_pos_service", label: "Service" }]; // the ids of the Leads pick-list
export const PROJECT_STATUS_DEFAULT = "planning";

// A worked-out column of a template table
const calc = (key: string, label: string, section: string): SystemField => ({ key, label, type: "CALC", section, notListable: true });

const PROJECT: ModuleDef = {
  id: "project",
  slug: "projects",
  label: "Project",
  plural: "Projects",
  heading: "Project Management",
  createLabel: "Convert to Project",
  idPrefix: "MP",
  idLabel: "Project Code",
  counterKey: "project",
  permission: "projects",
  model: "project",
  table: "Project",
  entityType: "Project",
  nameKey: "name",
  hasApproval: false,
  custom: true,
  allowLookupFields: true,
  allowMultiSelect: true,
  defaultColumns: [],
  sections: [
    { id: "info", label: "Project Information", kind: "FORM" },
    { id: "summary", label: "Financial Summary", kind: "FIXED" },
    { id: "valueInfo", label: "Project Value Information", kind: "TABLE" },
    { id: "vendorSelection", label: "Vendor Selection", kind: "TABLE" },
    { id: "workCoverage", label: "Work Coverage", kind: "TABLE" },
    { id: "materialVendors", label: "Material Vendor Involvement", kind: "TABLE" },
    { id: "serviceVendors", label: "Service Vendor Involvement", kind: "TABLE" },
    { id: "payments", label: "Payment Collection", kind: "FIXED" },
    { id: "expenses", label: "Site Expenses", kind: "FIXED" },
    { id: "tasks", label: "Task", kind: "FIXED" },
    { id: "procurement", label: "Material Procurement", kind: "TABLE" },
  ],
  fields: [
    // Project Information (the left column, then the right one: the page shows them in two columns, like the reference)
    { key: "projectCode", label: "Project Code", type: "AUTO", section: "info", required: true, requiredLocked: true, readOnly: true, notListable: true },
    { key: "dealId", label: "Deal Number", type: "LOOKUP", section: "info", lookup: "deal", relation: "deal", readOnly: true, notListable: true },
    { key: "name", label: "Project Name", type: "TEXT", section: "info", required: true, requiredLocked: true, notListable: true, max: 200 },
    { key: "siteLocation", label: "Site Location", type: "TEXT", section: "info", notListable: true, max: 500 },
    { key: "siteLocationLink", label: "Site Location Link", type: "URL", section: "info", notListable: true },
    { key: "startDate", label: "Project Start Date", type: "DATE", section: "info", notListable: true },
    { key: "actualStartDate", label: "Actual Start Date", type: "DATE", section: "info", notListable: true },
    { key: "expectedEndDate", label: "Project Completion Date", type: "DATE", section: "info", notListable: true },
    { key: "completedDate", label: "Completed Date", type: "DATE", section: "info", notListable: true },
    { key: "priorCompletionDate", label: "Prior Completion Date", type: "DATE", section: "info", notListable: true },
    { key: "productOrService", label: "Product / Service", type: "DROPDOWN", section: "info", notListable: true, options: PROJECT_PRODUCT_OR_SERVICE },
    { key: "status", label: "Project Status", type: "DROPDOWN", section: "info", notListable: true, options: ids(["Planning", "In Progress", "On Hold", "Completed", "Cancelled"]), default: PROJECT_STATUS_DEFAULT },
    { key: "progress", label: "Completion %", type: "NUMBER", section: "info", notListable: true, integer: true, min: 0 },
    // Financial Summary: the numbers are worked out; Exclusions and Incentive % are typed
    calc("projectValue", "Project Value", "summary"),
    calc("collectedAmount", "Collected Amount", "summary"),
    calc("balanceAmount", "Balance Amount", "summary"),
    calc("expensesTotal", "Expenses", "summary"),
    calc("profitValue", "Profit Value", "summary"),
    { key: "exclusions", label: "Exclusions", type: "CURRENCY", section: "summary", notListable: true, prefix: "Rs." },
    { key: "incentivePercent", label: "Incentive %", type: "NUMBER", section: "summary", notListable: true, min: 0 },
    calc("profitAfterExclusions", "Profit After Exclusions", "summary"),
    calc("incentiveAmount", "Incentive Amount", "summary"),
    // Payment Collection: the PCRs of the deal
    calc("pcNo", "No", "payments"),
    calc("pcDate", "Date", "payments"),
    calc("pcCode", "PCR No", "payments"),
    calc("pcMode", "Payment Mode", "payments"),
    calc("pcVendor", "Material / Service Vendor Name", "payments"),
    calc("pcPaymentDate", "Payment Date", "payments"),
    calc("pcRemarks", "Remarks", "payments"),
    calc("pcAttachment", "Attachment", "payments"),
    calc("pcAmount", "Amount", "payments"),
    // Site Expenses: the PPRs of the deal
    calc("seNo", "No", "expenses"),
    calc("seDate", "Date", "expenses"),
    calc("seCode", "PPR No", "expenses"),
    calc("seMode", "Payment Mode", "expenses"),
    calc("seVendor", "Material / Service Vendor Name", "expenses"),
    calc("sePaymentDate", "Payment Date", "expenses"),
    calc("seRemarks", "Remarks", "expenses"),
    calc("seAttachment", "Attachment", "expenses"),
    calc("seWorkType", "Work Type", "expenses"),
    calc("seAmount", "Amount", "expenses"),
    // Task: the tasks of the project (the Tasks page's own records)
    calc("tkNo", "Task ID", "tasks"),
    calc("tkName", "Task Name", "tasks"),
    calc("tkAssignedTo", "Assigned To", "tasks"),
    calc("tkAssignedBy", "Assigned By", "tasks"),
    calc("tkAssignedAt", "Assigned Date and Time", "tasks"),
    calc("tkCompletedAt", "Completed Date and Time", "tasks"),
  ],
  tables: [
    {
      section: "valueInfo", relation: "quoteLines", model: "projectQuoteLine", table: "ProjectQuoteLine", parentKey: "projectId", parentRelation: "project",
      fields: [
        calc("viNo", "No", "valueInfo"),
        calc("viQuoteNo", "Quote No", "valueInfo"),
        calc("viQuoteDate", "Quote Date", "valueInfo"),
        calc("viReference", "Reference", "valueInfo"),
        calc("viQuoteValue", "Quote Value", "valueInfo"),
        { key: "quoteExclusion", label: "Exclusions", type: "CURRENCY", section: "valueInfo", prefix: "" },
        calc("viTotal", "Total Quote Value", "valueInfo"),
      ],
    },
    {
      section: "vendorSelection", relation: "itemSelections", model: "projectItemSelection", table: "ProjectItemSelection", parentKey: "projectId", parentRelation: "project",
      fields: [
        calc("vsNo", "Item No", "vendorSelection"),
        calc("vsItem", "Item", "vendorSelection"),
        { key: PROJECT_TEMPLATE_FIELD, label: "Template", type: "DROPDOWN", section: "vendorSelection", options: PROJECT_TEMPLATES },
        calc("vsVendors", "Service Vendor / Material Vendor", "vendorSelection"),
      ],
    },
    {
      section: "workCoverage", relation: "workCoverage", model: "projectWorkCoverage", table: "ProjectWorkCoverage", parentKey: "projectId", parentRelation: "project",
      fields: [
        calc("wcNo", "No", "workCoverage"),
        calc("wcTemplate", "Template", "workCoverage"),
        calc("wcItemValue", "Item Value", "workCoverage"),
        calc("wcAmountSpent", "Amount Spent", "workCoverage"),
        calc("wcProfit", "Profit Earned", "workCoverage"),
        { key: "completed", label: "Completed", type: "CHECKBOX", section: "workCoverage" },
      ],
    },
    {
      section: "materialVendors", relation: "materialVendors", model: "projectMaterialVendor", table: "ProjectMaterialVendor", parentKey: "projectId", parentRelation: "project",
      fields: [
        calc("mvNo", "No", "materialVendors"),
        { key: "materialCode", label: "Material Code", type: "TEXT", section: "materialVendors", readOnly: true },
        { key: "materialVendorId", label: "Material Vendor Name", type: "LOOKUP", section: "materialVendors", lookup: "materialVendor", readOnly: true },
        { key: "materialList", label: "Material List", type: "TEXTAREA", section: "materialVendors", max: 5000 },
        { key: "materialQuotedValue", label: "Quoted Value", type: "CURRENCY", section: "materialVendors", prefix: "" },
        { key: "planningToTake", label: "Planning to Take", type: "DATE", section: "materialVendors" },
        { key: "takenDate", label: "Taken Date", type: "DATE", section: "materialVendors" },
        { key: "materialStatus", label: "Status", type: "DROPDOWN", section: "materialVendors", options: ids(["Pending", "Ordered", "In Transit", "Received", "Partially Received", "Cancelled"]) },
        calc("mvGiven", "Given Amount", "materialVendors"),
        calc("mvBalance", "Balance Amount", "materialVendors"),
        { key: "materialBill", label: "Bill", type: "FILE", section: "materialVendors", maxFiles: 3 },
        { key: "materialTaskPersonId", label: "Task Person", type: "USER", section: "materialVendors" },
        calc("mvCredit", "Credit Value", "materialVendors"),
      ],
    },
    {
      section: "serviceVendors", relation: "serviceVendors", model: "projectServiceVendor", table: "ProjectServiceVendor", parentKey: "projectId", parentRelation: "project",
      fields: [
        calc("svNo", "No", "serviceVendors"),
        { key: "serviceCode", label: "Service Code", type: "TEXT", section: "serviceVendors", readOnly: true },
        { key: "serviceVendorId", label: "Service Vendor Name", type: "LOOKUP", section: "serviceVendors", lookup: "serviceVendor", readOnly: true },
        { key: "serviceQuotedValue", label: "Quoted Value", type: "CURRENCY", section: "serviceVendors", prefix: "" },
        { key: "serviceStartDate", label: "Start Date", type: "DATE", section: "serviceVendors" },
        { key: "serviceStartedDate", label: "Started Date", type: "DATE", section: "serviceVendors" },
        { key: "serviceCompletionDate", label: "Completion Date", type: "DATE", section: "serviceVendors" },
        { key: "serviceCompletedDate", label: "Completed Date", type: "DATE", section: "serviceVendors" },
        calc("svDuration", "Duration", "serviceVendors"),
        calc("svGiven", "Given Amount", "serviceVendors"),
        calc("svBalance", "Balance Amount", "serviceVendors"),
        calc("svPayment", "Payment", "serviceVendors"),
        calc("svHistory", "History", "serviceVendors"),
      ],
    },
    {
      section: "procurement", relation: "procurementRows", model: "projectProcurementRow", table: "ProjectProcurementRow", parentKey: "projectId", parentRelation: "project",
      fields: [
        calc("prNo", "S No", "procurement"),
        { key: "procVendorName", label: "Vendor Name", type: "TEXT", section: "procurement", max: 200 },
        { key: "procVendorNumber", label: "Vendor Number", type: "PHONE", section: "procurement" },
        { key: "procLocation", label: "Location", type: "TEXT", section: "procurement", max: 300 },
        { key: "procQuoteValue", label: "Quote Value", type: "CURRENCY", section: "procurement", prefix: "" },
        { key: "procBill", label: "Quote Bill", type: "FILE", section: "procurement", maxFiles: 3 },
        { key: "procSize", label: "Size and Other Information", type: "TEXT", section: "procurement", max: 500 },
        { key: "procNotes", label: "Notes", type: "TEXTAREA", section: "procurement", max: 5000 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Customer: the Zoho Books "New Customer" form, opened from Create Quote > Customer Name (src/lib/customers, src/app/customers). This definition is
// what Edit Page Layout works on: labels, mandatory, hidden, order, new fields, the choices of every dropdown. The form draws these fields itself:
//   info      the top of the form (type, primary contact, names, email, customer number, phones, language, communication channels)
//   other     the "Other Details" tab (GST, place of supply, PAN, tax, currency, balances, payment terms, portal, documents)
//   billing + shipping   the "Address" tab, side by side
//   remarks   the "Remarks" tab; a section added with New Section becomes one more tab
// The key of a field is the column of the Customer table. The option id of most dropdowns is the text that is stored.
// ---------------------------------------------------------------------------
const plain = (labels: string[]): FieldOption[] => labels.map(l => ({ id: l, label: l }));
const addressFields = (side: "bill" | "ship"): SystemField[] => {
  const section = side === "bill" ? "billing" : "shipping";
  return [
    { key: `${side}Attention`, label: "Attention", type: "TEXT", section, notListable: true, max: 200 },
    { key: `${side}Country`, label: "Country/Region", type: "DROPDOWN", section, notListable: true, options: plain(COUNTRIES), default: DEFAULT_COUNTRY },
    { key: `${side}Street1`, label: "Street 1", type: "TEXTAREA", section, notListable: true, max: 500 },
    { key: `${side}Street2`, label: "Street 2", type: "TEXTAREA", section, notListable: true, max: 500 },
    { key: `${side}City`, label: "City", type: "TEXT", section, notListable: true, max: 100 },
    { key: `${side}State`, label: "State", type: "TEXT", section, notListable: true, max: 100 },
    { key: `${side}PinCode`, label: "Pin Code", type: "TEXT", section, notListable: true, max: 12 },
    { key: `${side}Phone`, label: "Phone", type: "PHONE", section, notListable: true },
    { key: `${side}Fax`, label: "Fax Number", type: "TEXT", section, notListable: true, max: 30 },
  ];
};

const CUSTOMER: ModuleDef = {
  id: "customer",
  slug: "customers",
  label: "Customer",
  plural: "Customers",
  heading: "Customers",
  createLabel: "New Customer",
  idPrefix: "CUS",
  idLabel: "Customer Number",
  counterKey: CUSTOMER_COUNTER,
  permission: "leads",
  model: "customer",
  table: "Customer",
  entityType: "Customer",
  nameKey: "name",
  hasApproval: false,
  custom: true,
  allowMultiSelect: true,
  hardRecords: true,
  defaultColumns: [],
  sections: [
    { id: "info", label: "Customer Details", kind: "FORM" },
    { id: "other", label: "Other Details", kind: "FORM" },
    { id: "billing", label: "Billing Address", kind: "FORM" },
    { id: "shipping", label: "Shipping Address", kind: "FORM" },
    { id: "remarks", label: "Remarks", kind: "FORM" },
  ],
  fields: [
    { key: "customerType", label: "Customer Type", type: "DROPDOWN", section: "info", notListable: true, options: plain(CUSTOMER_TYPES), default: "Individual" },
    { key: "salutation", label: "Salutation", type: "DROPDOWN", section: "info", notListable: true, options: plain(SALUTATIONS) },
    { key: "firstName", label: "First Name", type: "TEXT", section: "info", notListable: true, max: 100 },
    { key: "lastName", label: "Last Name", type: "TEXT", section: "info", notListable: true, max: 100 },
    { key: "companyName", label: "Company Name", type: "TEXT", section: "info", notListable: true, max: 200 },
    { key: "name", label: "Display Name", type: "TEXT", section: "info", required: true, requiredLocked: true, notListable: true, max: 200 },
    { key: "email", label: "Email Address", type: "EMAIL", section: "info", notListable: true },
    { key: "customerCode", label: "Customer Number", type: "AUTO", section: "info", required: true, requiredLocked: true, readOnly: true, notListable: true },
    { key: "workPhone", label: "Work Phone", type: "PHONE", section: "info", notListable: true },
    { key: "phone", label: "Mobile", type: "PHONE", section: "info", notListable: true },
    { key: "language", label: "Customer Language", type: "DROPDOWN", section: "info", notListable: true, options: plain(LANGUAGES), default: DEFAULT_LANGUAGE },
    { key: "commEmail", label: "Email", type: "CHECKBOX", section: "info", notListable: true },
    { key: "commWhatsapp", label: "WhatsApp", type: "CHECKBOX", section: "info", notListable: true, default: "true" },
    // Other Details
    { key: "gstTreatment", label: "GST Treatment", type: "DROPDOWN", section: "other", required: true, notListable: true, options: GST_TREATMENTS.map(t => ({ id: t.id, label: t.label })) },
    { key: "gstin", label: "GSTIN / UIN", type: "TEXT", section: "other", notListable: true, max: 15 },
    { key: "legalName", label: "Business Legal Name", type: "TEXT", section: "other", notListable: true, max: 200 },
    { key: "tradeName", label: "Business Trade Name", type: "TEXT", section: "other", notListable: true, max: 200 },
    { key: "placeOfSupply", label: "Place of Supply", type: "DROPDOWN", section: "other", required: true, notListable: true, options: GST_STATES.map(([code, name]) => ({ id: code, label: `[${GST_STATE_ABBR[code] ?? code}] - ${name}` })) },
    { key: "pan", label: "PAN", type: "TEXT", section: "other", notListable: true, max: 10 },
    { key: "taxPreference", label: "Tax Preference", type: "DROPDOWN", section: "other", required: true, notListable: true, options: TAX_PREFERENCES, default: "taxable" },
    { key: "currency", label: "Currency", type: "DROPDOWN", section: "other", notListable: true, options: CURRENCIES, default: DEFAULT_CURRENCY },
    { key: "accountsReceivable", label: "Accounts Receivable", type: "DROPDOWN", section: "other", notListable: true, options: ACCOUNTS_RECEIVABLE },
    { key: "openingBalance", label: "Opening Balance", type: "CURRENCY", section: "other", notListable: true, prefix: "INR" },
    { key: "creditLimit", label: "Credit Limit", type: "CURRENCY", section: "other", notListable: true, prefix: "INR" },
    { key: "paymentTerms", label: "Payment Terms", type: "DROPDOWN", section: "other", notListable: true, options: PAYMENT_TERMS, default: DEFAULT_PAYMENT_TERMS },
    { key: "portalEnabled", label: "Enable Portal?", type: "CHECKBOX", section: "other", notListable: true },
    { key: "documents", label: "Documents", type: "FILE", section: "other", notListable: true, maxFiles: 10 },
    // Address
    ...addressFields("bill"),
    ...addressFields("ship"),
    // Remarks
    { key: "remarks", label: "Remarks", type: "TEXTAREA", section: "remarks", notListable: true, max: 5000 },
  ],
  tables: [],
};

// ---------------------------------------------------------------------------
// Item: the Item Master of the Quote page. The New Item form has its own fixed layout and its own service (src/lib/quotes/catalog.ts); this definition
// only exists so the pictures of an item use the same upload engine as every other file: a private Storage bucket, a signed upload, attached when the
// item is saved.
// ---------------------------------------------------------------------------
const ITEM: ModuleDef = {
  id: "item",
  slug: "quote-items",
  label: "Item",
  plural: "Items",
  heading: "Items",
  createLabel: "New Item",
  idPrefix: "ITM",
  idLabel: "Item",
  counterKey: "item",
  permission: "quotes",
  model: "catalogItem",
  table: "CatalogItem",
  entityType: "Item",
  nameKey: "name",
  hasApproval: false,
  custom: true,
  defaultColumns: [],
  sections: [{ id: "images", label: "Pictures", kind: "FORM" }],
  fields: [
    { key: ITEM_IMAGE_FIELDS.front, label: "Front View", type: "FILE", section: "images", notListable: true, maxFiles: 1 },
    { key: ITEM_IMAGE_FIELDS.rear, label: "Rear View", type: "FILE", section: "images", notListable: true, maxFiles: 1 },
    { key: ITEM_IMAGE_FIELDS.other, label: "Other Images", type: "FILE", section: "images", notListable: true, maxFiles: MAX_OTHER_IMAGES },
  ],
  tables: [],
};

export const MODULES: Record<ModuleId, ModuleDef> = {
  materialVendor: MATERIAL_VENDOR,
  serviceVendor: SERVICE_VENDOR,
  prePayment: paymentModule("pre"),
  paymentCollection: paymentModule("collection"),
  quote: QUOTE,
  project: PROJECT,
  customer: CUSTOMER,
  item: ITEM,
};

export const MODULE_LIST: ModuleDef[] = [MODULES.materialVendor, MODULES.serviceVendor, MODULES.prePayment, MODULES.paymentCollection, MODULES.quote, MODULES.project, MODULES.customer, MODULES.item];

export function moduleBySlug(slug: string): ModuleDef | null {
  return MODULE_LIST.find(m => m.slug === slug) ?? null;
}

export const NOT_YET_APPROVED = "Not Yet Approved";
