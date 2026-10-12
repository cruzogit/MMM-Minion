import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/api";
import { removeTaskFile } from "@/lib/tasks/service";

// DELETE /api/tasks/:id/files/:fileId — requires tasks.edit and being the task person (or an administrator)
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  return withAuthRoute(request, async ctx => {
    const { id, fileId } = await params;
    await removeTaskFile(ctx, id, fileId);
    return NextResponse.json({ success: true });
  });
}
