import { NextResponse } from "next/server";
import { readJson, withAuthRoute } from "@/lib/api";
import { quoteAbilities } from "@/lib/quotes/access";
import { deleteQuote, getQuote, QuoteStaleError, updateQuote } from "@/lib/quotes/service";
import type { QuoteBody } from "@/lib/quotes/types";
import { originOf, quoteBodySchema } from "../helpers";

type Params = { params: Promise<{ id: string }> };

// GET /api/quotes/:id — one quote with its layout and settings. Needs view.
export async function GET(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { id } = await params;
    const res = await getQuote(ctx, id, originOf(request));
    return NextResponse.json({ ...res, abilities: quoteAbilities(ctx) });
  });
}

// PUT /api/quotes/:id — edit a quote. Needs edit.
export async function PUT(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { id } = await params;
    const { draftId: _draft, force, ...body } = await readJson(request, quoteBodySchema);
    void _draft;
    try {
      return NextResponse.json({ success: true, ...(await updateQuote(ctx, id, body as unknown as QuoteBody, { force: force === true })) });
    } catch (e) {
      // the page asks "save anyway?" and sends the same body again with force
      if (e instanceof QuoteStaleError) return NextResponse.json({ error: e.message, code: "STALE" }, { status: 409 });
      throw e;
    }
  });
}

// DELETE /api/quotes/:id — delete a quote (it is only hidden: its number is never used again). Needs delete.
export async function DELETE(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { id } = await params;
    return NextResponse.json(await deleteQuote(ctx, id));
  });
}
