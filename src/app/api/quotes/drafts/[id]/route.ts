import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { discardNewDraft, getNewDraft, saveNewDraft } from "@/lib/quotes/draft-server";
import { needQuotes } from "@/lib/quotes/access";
import { ServiceError } from "@/lib/users/service";

type Params = { params: Promise<{ id: string }> };
const body = z.object({ state: z.unknown(), rev: z.number().int().min(0).max(1_000_000_000), force: z.boolean().optional() }).strict();

// GET /api/quotes/drafts/:id — the new quote in progress as it was last saved (only for the person who started it)
export async function GET(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    needQuotes(ctx, "create");
    const draft = await getNewDraft(ctx, (await params).id);
    if (!draft) throw new ServiceError(404, "This quote in progress no longer exists: it was saved or discarded.");
    return NextResponse.json(draft);
  });
}

// PUT /api/quotes/drafts/:id { state, rev, force? } — auto-save. A save that carries an older rev than the server's is refused (409); `force` keeps this version.
export async function PUT(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { state, rev, force } = await readJson(request, body);
    return NextResponse.json(await saveNewDraft(ctx, (await params).id, state, rev, force === true));
  });
}

// DELETE /api/quotes/drafts/:id — "Leave and Discard Changes" on a new quote: the draft is deleted for good and its quote number is given back.
export async function DELETE(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => NextResponse.json(await discardNewDraft(ctx, (await params).id)));
}
