import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";
import { sanitizeTaskLayout, type TaskLayout } from "./layout-shared";

const MODULE = "tasks"; // the row of ModuleLayout that holds the Tasks layout

export async function getTaskLayout(): Promise<TaskLayout> {
  const row = await prisma.moduleLayout.findUnique({ where: { module: MODULE }, select: { value: true } });
  return sanitizeTaskLayout(row?.value).layout;
}

export const canEditTaskLayout = (ctx: AuthContext) => hasPermission(ctx.permissions, "tasks", "edit");

// Saves the whole layout the editor sends. A custom type that tasks still use cannot be deleted (hide it instead); a custom
// status that is renamed carries its tasks along, and one that is deleted moves its tasks back to Not Started.
export async function saveTaskLayout(ctx: AuthContext, raw: unknown): Promise<TaskLayout> {
  if (!canEditTaskLayout(ctx)) throw new ServiceError(403, "You do not have permission to change the page layout.");
  const { layout, errors } = sanitizeTaskLayout(raw);
  if (errors.length) throw new ServiceError(400, errors[0]);

  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ModuleLayout:tasks"}))`;
    const row = await tx.moduleLayout.findUnique({ where: { module: MODULE }, select: { value: true } });
    const old = sanitizeTaskLayout(row?.value).layout;

    for (const t of old.types.filter(t => !t.builtin && !layout.types.some(n => n.id === t.id))) {
      const used = await tx.task.count({ where: { taskType: t.id } });
      if (used) throw new ServiceError(400, `${used} task${used > 1 ? "s use" : " uses"} the type "${t.label}". Hide it instead of deleting it.`);
    }
    for (const s of old.statuses.filter(s => !s.builtin)) {
      const now = layout.statuses.find(n => n.id === s.id);
      if (!now) await tx.task.updateMany({ where: { status: s.label }, data: { status: "Not Started" } });
      else if (now.label !== s.label) await tx.task.updateMany({ where: { status: s.label }, data: { status: now.label } });
    }

    const value = layout as unknown as Prisma.InputJsonValue;
    await tx.moduleLayout.upsert({ where: { module: MODULE }, update: { value }, create: { module: MODULE, value } });
    return layout;
  });
}
