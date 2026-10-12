import { NextResponse } from "next/server";
import { readJson, withAuthRoute } from "@/lib/api";
import { taskFilesCompleteSchema, taskFilesSignSchema } from "@/lib/tasks/schemas";
import { completeTaskFiles, signTaskFiles } from "@/lib/tasks/service";

type Params = { params: Promise<{ id: string }> };

// POST /api/tasks/:id/files — step 1: validate the file list and return signed upload URLs
export async function POST(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { files } = await readJson(request, taskFilesSignSchema);
    return NextResponse.json(await signTaskFiles(ctx, (await params).id, files));
  });
}

// PUT /api/tasks/:id/files — step 2: after the browser uploaded, check the stored bytes and record the files
export async function PUT(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const { files } = await readJson(request, taskFilesCompleteSchema);
    return NextResponse.json(await completeTaskFiles(ctx, (await params).id, files));
  });
}
