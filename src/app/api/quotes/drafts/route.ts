import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { createNewDraft, listMyDrafts } from "@/lib/quotes/draft-server";
import { needQuotes } from "@/lib/quotes/access";

const body = z.object({ state: z.unknown() }).strict();

// GET /api/quotes/drafts — the quotes this person has in progress (new quotes and saved quotes being edited), newest first. Needs view.
export async function GET(request: Request) {
  return withAuthRoute(request, async ctx => {
    needQuotes(ctx, "view");
    return NextResponse.json({ drafts: await listMyDrafts(ctx) });
  });
}

// POST /api/quotes/drafts { state } — the first auto-save of a new quote: the draft is created and a quote number is reserved for it. Needs create.
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    const { state } = await readJson(request, body);
    return NextResponse.json(await createNewDraft(ctx, state), { status: 201 });
  });
}
