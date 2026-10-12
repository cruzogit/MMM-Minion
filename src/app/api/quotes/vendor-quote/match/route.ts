import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { matchVendorItems, VENDOR_MAX_ROWS } from "@/lib/quotes/vendor-quote-server";

const body = z.object({ names: z.array(z.string().max(500)).max(VENDOR_MAX_ROWS) }).strict();

// POST /api/quotes/vendor-quote/match { names } — which of the item names of an uploaded vendor quotation are items of the Items module (Existing) and which
// are not (New): the same name after trimming, one space between words and ignoring capital letters; nothing similar counts. Nothing is saved.
// The answer is keyed by the compared name (lower case, single spaces).
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    const { names } = await readJson(request, body);
    return NextResponse.json({ matches: await matchVendorItems(ctx, names) });
  });
}
