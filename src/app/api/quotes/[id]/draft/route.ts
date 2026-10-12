import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { discardEditDraft, saveEditDraft } from "@/lib/quotes/draft-server";

type Params = { params: Promise<{ id: string }> };
const body = z.object({ state: z.unknown(), rev: z.number().int().min(0).max(1_000_000_000).nullable(), force: z.boolean().optional() }).strict();

// PUT /api/quotes/:id/draft { state, rev, force? } — auto-save of the changes made while editing a saved quote. They go to a working copy; the quote itself
// is not touched until Save. rev null = the first save of the copy. Needs edit.
export async function PUT(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { state, rev, force } = await readJson(request, body);
    return NextResponse.json(await saveEditDraft(ctx, (await params).id, state, rev, force === true));
  });
}

// DELETE /api/quotes/:id/draft — "Leave and Discard Changes" on a saved quote: only the working copy is deleted; the quote and its number stay as they were.
export async function DELETE(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => NextResponse.json(await discardEditDraft(ctx, (await params).id)));
}
