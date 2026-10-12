import { NextResponse } from "next/server";
import { z } from "zod";
import { readJson, withAuthRoute } from "@/lib/api";
import { getTaskLayout, saveTaskLayout } from "@/lib/tasks/layout";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";

const body = z.object({ fields: z.array(z.unknown()).max(80), types: z.array(z.unknown()).max(40), statuses: z.array(z.unknown()).max(40) }).strict();

// GET /api/tasks/layout — requires tasks.view
export async function GET(request: Request) {
  return withAuthRoute(request, async ctx => {
    if (!hasPermission(ctx.permissions, "tasks", "view")) throw new ServiceError(403, "You do not have permission to view tasks.");
    return NextResponse.json({ layout: await getTaskLayout() });
  });
}

// PUT /api/tasks/layout — Super Admin only: replaces the whole layout (form fields, task types, task statuses)
export async function PUT(request: Request) {
  return withAuthRoute(request, async ctx => NextResponse.json({ layout: await saveTaskLayout(ctx, await readJson(request, body)) }));
}
