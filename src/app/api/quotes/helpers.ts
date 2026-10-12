import { z } from "zod";
import { originFromHeaders } from "@/lib/quotes/origin";

// The address of this site as the person's browser sees it
export const originOf = (request: Request): string => originFromHeaders(request.headers, new URL(request.url).host);

// The body of a quote (create and edit): what the service checks is decided by the layout, so the shape here is only what is safe to read
export const quoteBodySchema = z.object({
  values: z.record(z.string().max(64), z.unknown()).default({}),
  lines: z.array(z.unknown()).max(500).default([]),
  calc: z.object({
    discountPercent: z.unknown().optional(),
    shippingCharges: z.unknown().optional(),
    withholding: z.object({ kind: z.enum(["TDS", "TCS"]), taxId: z.string().min(1).max(60) }).strict().nullable().optional(),
    adjustmentLabel: z.string().max(200).nullable().optional(),
    adjustment: z.unknown().optional(),
  }).strict().default({}),
  intent: z.enum(["draft", "save", "send"]),
  profitPercent: z.union([z.number(), z.string().max(20), z.null()]).optional(),
  draftId: z.string().max(64).nullable().optional(), // Add Quote: the auto-saved draft this quote started as
  force: z.boolean().optional(), // Edit Quote: save although somebody else saved the quote meanwhile
}).strict();

// The body of an item (create and edit): what the New Item form sends. Every key is optional here; the service decides what is required.
export const itemBodySchema = z.object({
  name: z.unknown().optional(), description: z.unknown().optional(), hsn: z.unknown().optional(), unit: z.unknown().optional(), unitGroup: z.unknown().optional(),
  rate: z.unknown().optional(), taxId: z.unknown().optional(), kind: z.unknown().optional(), isActive: z.unknown().optional(),
  category: z.unknown().optional(), sku: z.unknown().optional(), taxPreference: z.unknown().optional(), identifiers: z.unknown().optional(),
  trackInventory: z.unknown().optional(), inventoryTracking: z.unknown().optional(), inventoryAccount: z.unknown().optional(), valuationMethod: z.unknown().optional(),
  reorderPoint: z.unknown().optional(), returnable: z.unknown().optional(), dimLength: z.unknown().optional(), dimWidth: z.unknown().optional(), dimHeight: z.unknown().optional(),
  dimUnit: z.unknown().optional(), weight: z.unknown().optional(), weightUnit: z.unknown().optional(), taskTemplateId: z.unknown().optional(), files: z.unknown().optional(),
  purchaseInfo: z.unknown().optional(), costPrice: z.unknown().optional(), purchaseAccount: z.unknown().optional(), purchaseDescription: z.unknown().optional(), receivable: z.unknown().optional(), interTaxId: z.unknown().optional(),
  brand: z.unknown().optional(), manufacturer: z.unknown().optional(), mrp: z.unknown().optional(),
}).strict();
