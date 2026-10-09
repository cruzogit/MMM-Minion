import { prisma } from "@/lib/db";
import { SAFE_USER_SELECT } from "@/lib/safe-select";

export async function getProjects() {
  try {
    const projects = await prisma.project.findMany({
      include: {
        customer: true,
        lead: {
          include: {
            salesExecutive: {
              include: { user: { select: SAFE_USER_SELECT } }
            }
          }
        },
        deal: true,
        manager: {
          include: {
            user: { select: SAFE_USER_SELECT }
          }
        },
        expenses: true,
        payments: true,
        boqItems: true,
        tasks: true,
        _count: {
          select: { tasks: true, boqItems: true, expenses: true, payments: true }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    });
    return projects;
  } catch (error) {
    console.error("Failed to fetch projects:", error);
    return [];
  }
}

export async function getProjectById(id: string) {
  if (!id || typeof id !== 'string') return null;
  try {
    const project = await prisma.project.findUnique({
      where: { id },
      include: {
        customer: true,
        lead: {
          include: {
            salesExecutive: {
              include: { user: { select: SAFE_USER_SELECT } }
            }
          }
        },
        deal: true,
        manager: {
          include: {
            user: { select: SAFE_USER_SELECT }
          }
        },
        tasks: {
          include: {
            assignee: {
              include: { user: { select: SAFE_USER_SELECT } }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        boqItems: {
          orderBy: { category: 'asc' }
        },
        expenses: {
          include: { vendor: true },
          orderBy: { date: 'desc' }
        },
        payments: {
          orderBy: { date: 'desc' }
        }
      }
    });
    return project;
  } catch (error) {
    console.error(`Failed to fetch project ${id}:`, error);
    return null;
  }
}

