import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { applyVendorItems, VENDOR_MAX_ROWS } from "@/lib/quotes/vendor-quote-server";

const row = z.object({
  key: z.string().min(1).max(100),
  action: z.enum(["update", "keep", "add", "quote-only"]),
  itemId: z.string().max(64).nullable(),
  name: z.string().max(500),
  description: z.string().max(5000),
  rate: z.number(),
  sellingRate: z.number(),
  unit: z.string().max(100),
}).strict();
const body = z.object({ rows: z.array(row).min(1).max(VENDOR_MAX_ROWS) }).strict();

// POST /api/quotes/vendor-quote/apply { rows } — saves what the person confirmed for the rows of an uploaded vendor quotation, all or nothing:
// Existing items are updated (corrected description and the vendor rate as cost price) or kept; New items are added to the Items module or stay on the quote only.
// Updating needs the Quotes "edit" permission, adding needs "create". Answers the item (with its tax, HSN/SAC, unit and Task Template) of every row that has one.
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    const { rows } = await readJson(request, body);
    return NextResponse.json(await applyVendorItems(ctx, rows));
  });
}
