"use server";
import { authorizeAction } from "@/lib/auth";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { SAFE_USER_SELECT } from "@/lib/safe-select";

// Our own messages ("No employee found for author") are shown as they are; a database error names tables and files, so it is not
function messageOf(error: unknown, fallback: string) {
  if (error instanceof Error && error.message && !error.name.startsWith("PrismaClient") && !/prisma|invocation/i.test(error.message)) return error.message;
  return fallback;
}

export async function createTask(formData: FormData) {
  const auth = await authorizeAction("tasks", "create");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    const priority = (formData.get("priority") as string) || "Medium";
    const dueDateStr = formData.get("dueDate") as string;
    const startDateStr = formData.get("startDate") as string;
    
    const assigneeIdInput = formData.get("assigneeId") as string;
    const secondaryAssigneeIdInput = formData.get("secondaryAssigneeId") as string;
    const assignedById = formData.get("assignedById") as string;
    
    const projectId = formData.get("projectId") as string;
    const customerId = formData.get("customerId") as string;
    const leadId = formData.get("leadId") as string;
    const dealId = formData.get("dealId") as string;

    const requiresCompletionProof = formData.get("requiresCompletionProof") === "true";
    const requiresVerification = formData.get("requiresVerification") === "true";

    const isRecurring = formData.get("isRecurring") === "true";
    const repeatInterval = parseInt((formData.get("repeatInterval") as string) || "1", 10);
    const repeatUnit = (formData.get("repeatUnit") as string) || "Day";
    const repeatUntilStr = formData.get("repeatUntil") as string;

    if (!title) {
      return { success: false, error: "Task title is required." };
    }

    // Assignee resolution
    let assigneeId = assigneeIdInput;
    if (!assigneeId) {
      const fallback = (auth.ctx.employeeId ? await prisma.employee.findUnique({ where: { id: auth.ctx.employeeId } }) : null);
      if (fallback) assigneeId = fallback.id;
    }

    let recurringSeriesId = undefined;

    // Handle Recurring Series Creation
    if (isRecurring && assigneeId) {
      const series = await prisma.taskRecurringSeries.create({
        data: {
          title,
          description: description || null,
          repeatInterval,
          repeatUnit,
          repeatUntil: repeatUntilStr ? new Date(repeatUntilStr) : null,
          projectId: projectId || null,
          assigneeId,
          secondaryAssigneeId: secondaryAssigneeIdInput || null,
          requiresCompletionProof,
          requiresVerification,
          createdByEmployeeId: assignedById || assigneeId,
        }
      });
      recurringSeriesId = series.id;
    }

    // Create Initial Task (Instance)
    const task = await prisma.task.create({
      data: {
        title,
        description: description || null,
        priority,
        status: "Not Started",
        startDate: startDateStr ? new Date(startDateStr) : null,
        dueDate: dueDateStr ? new Date(dueDateStr) : null,
        assigneeId: assigneeId,
        secondaryAssigneeId: secondaryAssigneeIdInput || null,
        assignedByEmployeeId: assignedById || null,
        projectId: projectId || null,
        customerId: customerId || null,
        leadId: leadId || null,
        dealId: dealId || null,
        requiresCompletionProof,
        requiresVerification,
        isRecurringInstance: isRecurring,
        recurringSeriesId,
      }
    });

    // Create Activity Log
    await prisma.activity.create({
      data: {
        employeeId: assignedById || assigneeId,
        action: `Created task: ${title}${isRecurring ? ' (Recurring)' : ''}`,
        module: "TASKS",
        recordId: task.id,
      }
    }).catch(() => {});

    revalidatePath("/tasks");
    if (projectId) revalidatePath(`/projects/${projectId}`);
    revalidatePath("/my-work");

    return { success: true, taskId: task.id };
  } catch (error) {
    console.error("Failed to create task:", error);
    return { success: false, error: messageOf(error, "Failed to create task") };
  }
}

export async function updateTaskStatus(taskId: string, status: string) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const validStatuses = [
      "Not Started", "Assigned", "Accepted", "In Progress",
      "Blocked", "On Hold", "Completed", "Verified", "Closed", "Cancelled"
    ];

    if (!validStatuses.includes(status)) {
      return { success: false, error: `Invalid status: ${status}` };
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: { status }
    });

    revalidatePath("/tasks");
    revalidatePath("/my-work");
    if (task.projectId) revalidatePath(`/projects/${task.projectId}`);

    return { success: true, task };
  } catch (error) {
    console.error("Failed to update task status:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function updateTaskPriority(taskId: string, priority: string) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const task = await prisma.task.update({
      where: { id: taskId },
      data: { priority }
    });

    revalidatePath("/tasks");
    return { success: true, task };
  } catch (error) {
    console.error("Failed to update task priority:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function assignTask(taskId: string, assigneeId: string) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const employee = await prisma.employee.findUnique({ where: { id: assigneeId } });
    if (!employee) return { success: false, error: "Target employee not found." };

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        assigneeId: employee.id,
        status: "Assigned",
      }
    });

    revalidatePath("/tasks");
    revalidatePath("/my-work");
    return { success: true, task };
  } catch (error) {
    console.error("Failed to assign task:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function bulkAssignTasks(taskIds: string[], assigneeId: string) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    // An assignee that does not exist is an error: the tasks must not quietly end up with whoever pressed the button
    const validAssignee = await prisma.employee.findUnique({ where: { id: assigneeId } });
    if (!validAssignee) {
      return { success: false, error: "No employee found for assignment." };
    }

    await prisma.task.updateMany({
      where: { id: { in: taskIds } },
      data: {
        assigneeId: validAssignee.id,
        status: "Assigned",
      }
    });

    revalidatePath("/tasks");
    revalidatePath("/my-work");
    return { success: true, count: taskIds.length };
  } catch (error) {
    console.error("Failed to bulk assign tasks:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function addTaskComment(taskId: string, content: string, authorId?: string) {
  const auth = await authorizeAction("tasks", "view");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    let resolvedAuthorId = authorId;
    if (!resolvedAuthorId) {
      const validAssignee = (auth.ctx.employeeId ? await prisma.employee.findUnique({ where: { id: auth.ctx.employeeId } }) : null);
      if (validAssignee) resolvedAuthorId = validAssignee.id;
      else throw new Error("No employee found for author");
    }

    const comment = await prisma.taskComment.create({
      data: {
        taskId,
        content,
        authorId: resolvedAuthorId!,
      },
      include: { author: { include: { user: { select: SAFE_USER_SELECT } } } }
    });

    await prisma.activity.create({
      data: {
        employeeId: resolvedAuthorId!,
        action: `Commented on task`,
        module: "TASKS",
        recordId: taskId,
      }
    }).catch(() => {});

    revalidatePath("/tasks");
    return { success: true, comment };
  } catch (error) {
    console.error("Failed to add comment:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function addChecklistItem(taskId: string, content: string, employeeId?: string) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const item = await prisma.taskChecklistItem.create({
      data: {
        taskId,
        content,
      }
    });

    let resolvedEmpId = employeeId;
    if (!resolvedEmpId) {
      const validAssignee = (auth.ctx.employeeId ? await prisma.employee.findUnique({ where: { id: auth.ctx.employeeId } }) : null);
      if (validAssignee) resolvedEmpId = validAssignee.id;
    }

    if (resolvedEmpId) {
      await prisma.activity.create({
        data: {
          employeeId: resolvedEmpId,
          action: `Added checklist item: ${content}`,
          module: "TASKS",
          recordId: taskId,
        }
      }).catch(() => {});
    }

    revalidatePath("/tasks");
    return { success: true, item };
  } catch (error) {
    console.error("Failed to add checklist item:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function toggleChecklistItem(itemId: string, taskId: string, isCompleted: boolean, employeeId?: string) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const item = await prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: { isCompleted }
    });

    let resolvedEmpId = employeeId;
    if (!resolvedEmpId) {
      const validAssignee = (auth.ctx.employeeId ? await prisma.employee.findUnique({ where: { id: auth.ctx.employeeId } }) : null);
      if (validAssignee) resolvedEmpId = validAssignee.id;
    }

    if (resolvedEmpId) {
      await prisma.activity.create({
        data: {
          employeeId: resolvedEmpId,
          action: `${isCompleted ? 'Completed' : 'Unchecked'} checklist item`,
          module: "TASKS",
          recordId: taskId,
        }
      }).catch(() => {});
    }

    revalidatePath("/tasks");
    return { success: true, item };
  } catch (error) {
    console.error("Failed to toggle checklist item:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function deleteTask(taskId: string) {
  const auth = await authorizeAction("tasks", "delete");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const task = await prisma.task.findUnique({ where: { id: taskId }});
    if (!task) return { success: false, error: "Task not found" };

    // Delete related entities (Prisma handles cascading deletes if configured, but let's be explicit if not)
    await prisma.taskChecklistItem.deleteMany({ where: { taskId } });
    await prisma.taskComment.deleteMany({ where: { taskId } });
    await prisma.taskAuditLog.deleteMany({ where: { taskId } });
    
    await prisma.task.delete({ where: { id: taskId } });

    revalidatePath("/tasks");
    revalidatePath("/my-work");
    if (task.projectId) revalidatePath(`/projects/${task.projectId}`);
    return { success: true };
  } catch (error) {
    console.error("Failed to delete task:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function cloneTask(taskId: string, employeeId?: string) {
  const auth = await authorizeAction("tasks", "create");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const originalTask = await prisma.task.findUnique({ 
      where: { id: taskId },
      include: {
        checklists: true
      }
    });
    
    if (!originalTask) return { success: false, error: "Task not found" };

    const clonedTask = await prisma.task.create({
      data: {
        title: `${originalTask.title} (Copy)`,
        description: originalTask.description,
        priority: originalTask.priority,
        status: "Not Started",
        startDate: originalTask.startDate,
        dueDate: originalTask.dueDate,
        assigneeId: originalTask.assigneeId,
        secondaryAssigneeId: originalTask.secondaryAssigneeId,
        projectId: originalTask.projectId,
        customerId: originalTask.customerId,
        leadId: originalTask.leadId,
        dealId: originalTask.dealId,
        landscapeId: originalTask.landscapeId,
        requiresCompletionProof: originalTask.requiresCompletionProof,
        requiresVerification: originalTask.requiresVerification,
        checklists: {
          create: originalTask.checklists.map(item => ({
            content: item.content,
            isCompleted: false
          }))
        }
      }
    });

    let resolvedEmpId = employeeId;
    if (!resolvedEmpId) {
      const validAssignee = (auth.ctx.employeeId ? await prisma.employee.findUnique({ where: { id: auth.ctx.employeeId } }) : null);
      if (validAssignee) resolvedEmpId = validAssignee.id;
    }

    if (resolvedEmpId) {
      await prisma.activity.create({
        data: {
          employeeId: resolvedEmpId,
          action: `Cloned task from ${originalTask.title}`,
          module: "TASKS",
          recordId: clonedTask.id,
        }
      }).catch(() => {});
    }

    revalidatePath("/tasks");
    revalidatePath("/my-work");
    return { success: true, taskId: clonedTask.id };
  } catch (error) {
    console.error("Failed to clone task:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}

export async function updateTaskDetails(taskId: string, formData: FormData) {
  const auth = await authorizeAction("tasks", "edit");
  if (!auth.ok) return { success: false, error: auth.error };
  try {
    const title = formData.get("title") as string;
    const description = formData.get("description") as string;
    
    if (!title) {
      return { success: false, error: "Task title is required." };
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: {
        title,
        description: description || null,
      }
    });

    revalidatePath("/tasks");
    revalidatePath("/my-work");
    return { success: true, task };
  } catch (error) {
    console.error("Failed to update task:", error);
    return { success: false, error: messageOf(error, "Something went wrong. Please try again.") };
  }
}
