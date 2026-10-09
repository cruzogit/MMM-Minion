import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { getOverview, performAction } from "@/lib/attendance/service";
import { MAX_PURPOSE_TEXT, type ActionBody } from "@/lib/attendance/types";

// Office Out and Site In say where: one of the Site Visit Codes, or free text
const purpose = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CODE"), code: z.string().trim().min(1, "Choose a Site Visit Code.").max(40) }).strict(),
  z.object({ kind: z.literal("OTHER"), text: z.string().trim().min(1, "Enter the purpose or location.").max(MAX_PURPOSE_TEXT) }).strict(),
]);

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("CHECK_IN"),
    verification: z.object({
      method: z.enum(["FACE", "THUMB"]),
      verified: z.boolean(),
      confidence: z.number().optional(),
      snapshot: z.string().optional(),
    }).optional(),
  }),
  z.object({ action: z.literal("CHECK_OUT") }).strict(),
  z.object({ action: z.literal("OFFICE_IN") }).strict(),
  z.object({ action: z.literal("SITE_OUT") }).strict(),
  z.object({ action: z.literal("OFFICE_OUT"), purpose }).strict(),
  z.object({ action: z.literal("SITE_IN"), purpose }).strict(),
]);

// GET /api/attendance?month=2026-10 — the signed-in person's own month: calendar, summary, hours, today's state. Needs attendance.view.
export async function GET(request: Request) {
  return withAuthRoute(request, async ctx => {
    const month = new URL(request.url).searchParams.get("month");
    return NextResponse.json(await getOverview(ctx, { month }));
  });
}

// POST /api/attendance { action, purpose? } — Check In, Check Out, Office Out / Site In (with a purpose), Office In, Site Out. Needs attendance.create.
// The time recorded is the server's own clock. Answers with the refreshed overview of the current month.
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    const body = (await readJson(request, actionSchema)) as ActionBody;
    return NextResponse.json({ success: true, overview: await performAction(ctx, body) });
  });
}
