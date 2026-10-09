'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { CRM_STATS_TAG } from '@/services/crm';
import { requireAuth, requirePermission, requireAnyPermission } from '@/lib/auth';
import { CRM_MODULES } from '@/lib/rbac/catalog';
import { leadCodeFor, nextLeadSeq } from '@/lib/leads/service';
import { prisma } from '@/lib/db';
import { SAFE_USER_SELECT } from "@/lib/safe-select";

// ─── HELPERS ────────────────────────────────────────────────────────────────

// Always the signed-in user's own employee record; never a fallback identity
async function getCurrentEmployee() {
  const ctx = await requireAuth();
  const employee = ctx.employeeId
    ? await prisma.employee.findUnique({
        where: { id: ctx.employeeId },
        include: { user: { select: { id: true, name: true, email: true, role: { select: { name: true } } } } },
      })
    : null;
  if (!employee) {
    throw new Error('Your account is not linked to an employee record. Please contact your administrator.');
  }
  return { employee };
}

// Sales roles only see their own leads/deals
function isSalesOnlyRole(roleName?: string | null) {
  return ['sales', 'sales executive'].includes((roleName || '').toLowerCase());
}

function generateFollowUpNumber(count: number) {
  const year = new Date().getFullYear();
  return `FU-${year}-${String(count + 1).padStart(4, '0')}`;
}

function generateSiteVisitNumber(count: number) {
  const year = new Date().getFullYear();
  return `SV-${year}-${String(count + 1).padStart(4, '0')}`;
}

function generateDealNumber(count: number) {
  const year = new Date().getFullYear();
  return `DEAL-${year}-${String(count + 1).padStart(4, '0')}`;
}

function generateQuoteNumber(count: number) {
  const year = new Date().getFullYear();
  return `QT-${year}-${String(count + 1).padStart(4, '0')}`;
}

function generateCustomerCode(count: number) {
  const year = new Date().getFullYear();
  return `MIN-CUST-${year}-${String(count + 1).padStart(4, '0')}`;
}

async function createAuditLog(data: {
  entityType: string;
  entityId: string;
  action: string;
  oldValue?: object | string;
  newValue?: object | string;
  performedById?: string;
  leadId?: string;
  dealId?: string;
  quoteId?: string;
}) {
  try {
    await prisma.cRMAuditLog.create({
      data: {
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        oldValue: data.oldValue ? JSON.stringify(data.oldValue) : null,
        newValue: data.newValue ? JSON.stringify(data.newValue) : null,
        performedById: data.performedById,
        leadId: data.leadId,
        dealId: data.dealId,
        quoteId: data.quoteId,
      }
    });
  } catch (err) {
    console.error('Audit log failed:', err);
  }
}

async function sendNotification(employeeId: string, title: string, message: string, type: string, link?: string) {
  try {
    await prisma.notification.create({
      data: { employeeId, title, message, type, link }
    });
  } catch (err) {
    console.error('Notification failed:', err);
  }
}

// ─── CRM DASHBOARD STATS ─────────────────────────────────────────────────────

export async function getCRMStats(dateRange?: { from: Date; to: Date }) {
  await requireAnyPermission(CRM_MODULES);
  const { employee } = await getCurrentEmployee();
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  const from = dateRange?.from || startOfMonth;
  const to = dateRange?.to || endOfMonth;
  
  // Build where clause based on role/permissions
  const isSalesOnly = isSalesOnlyRole(employee?.user?.role?.name);
  const leadWhere = { deletedAt: null, ...(isSalesOnly && employee ? { salesExecutiveId: employee.id } : {}) };

  const [
    totalLeads,
    newLeads,
    followUpsTotal,
    followUpsToday,
    siteVisitsUpcoming,
    activeDeals,
    wonDealsThisMonth,
  ] = await Promise.all([
    prisma.lead.count({ where: leadWhere }),
    prisma.lead.count({ where: { ...leadWhere, status: 'New' } }),
    prisma.followUp.count({ where: { status: { in: ['Pending'] } } }),
    prisma.followUp.count({
      where: {
        status: 'Pending',
        scheduledDate: {
          gte: new Date(now.setHours(0, 0, 0, 0)),
          lte: new Date(now.setHours(23, 59, 59, 999)),
        }
      }
    }),
    prisma.siteVisit.count({ where: { status: { in: ['Scheduled', 'Confirmed'] } } }),
    prisma.deal.count({ where: { deletedAt: null, status: { notIn: ['Won', 'Lost', 'Cancelled'] } } }),
    prisma.deal.findMany({
      where: {
        deletedAt: null,
        status: 'Won',
        wonAt: { gte: from, lte: to }
      },
      select: { value: true }
    }),
  ]);

  const wonValue = wonDealsThisMonth.reduce((sum, d) => sum + Number(d.value), 0);

  // Pipeline value (sum of active deal values)
  const activeDealsValue = await prisma.deal.aggregate({
    where: { deletedAt: null, status: { notIn: ['Won', 'Lost', 'Cancelled'] } },
    _sum: { value: true }
  });
  const pipelineValue = Number(activeDealsValue._sum.value || 0);

  return {
    totalLeads,
    newLeads,
    followUps: { total: followUpsTotal, dueToday: followUpsToday },
    siteVisits: { upcoming: siteVisitsUpcoming },
    activeDeals: { count: activeDeals, pipeline: pipelineValue },
    wonThisMonth: { count: wonDealsThisMonth.length, value: wonValue },
  };
}

export async function getCRMAnalytics(dateRange?: { from: Date; to: Date }) {
  await requireAnyPermission(CRM_MODULES);
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const from = dateRange?.from || startOfMonth;
  const to = dateRange?.to || endOfMonth;

  const [
    totalLeadsInRange,
    wonLeadsInRange,
    totalFollowUps,
    completedFollowUps,
    totalSiteVisits,
    completedSiteVisits,
    totalQuotes,
    acceptedQuotes,
    totalDeals,
    wonDeals,
    activeDealAgg,
  ] = await Promise.all([
    prisma.lead.count({ where: { deletedAt: null, createdAt: { gte: from, lte: to } } }),
    prisma.lead.count({ where: { deletedAt: null, status: 'Won', createdAt: { gte: from, lte: to } } }),
    prisma.followUp.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.followUp.count({ where: { status: 'Completed', createdAt: { gte: from, lte: to } } }),
    prisma.siteVisit.count({ where: { createdAt: { gte: from, lte: to } } }),
    prisma.siteVisit.count({ where: { status: 'Completed', createdAt: { gte: from, lte: to } } }),
    prisma.quote.count({ where: { deletedAt: null, createdAt: { gte: from, lte: to } } }),
    prisma.quote.count({ where: { deletedAt: null, status: 'Accepted', createdAt: { gte: from, lte: to } } }),
    prisma.deal.count({ where: { deletedAt: null, createdAt: { gte: from, lte: to } } }),
    prisma.deal.count({ where: { deletedAt: null, status: 'Won', wonAt: { gte: from, lte: to } } }),
    prisma.deal.aggregate({
      where: { deletedAt: null, status: { notIn: ['Won', 'Lost', 'Cancelled'] } },
      _sum: { value: true }
    }),
  ]);

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 100));

  return {
    leadConversion: { value: pct(wonLeadsInRange, totalLeadsInRange), desc: `${wonLeadsInRange}/${totalLeadsInRange} won` },
    followUpRate: { value: pct(completedFollowUps, totalFollowUps), desc: `${completedFollowUps}/${totalFollowUps} done` },
    siteVisitConversion: { value: pct(completedSiteVisits, totalSiteVisits), desc: `${completedSiteVisits}/${totalSiteVisits} completed` },
    quoteAcceptance: { value: pct(acceptedQuotes, totalQuotes), desc: `${acceptedQuotes}/${totalQuotes} accepted` },
    dealConversion: { value: pct(wonDeals, totalDeals), desc: `${wonDeals}/${totalDeals} won` },
    pipelineValue: { value: Number(activeDealAgg._sum.value || 0), desc: `Active deals` },
  };
}

export async function getCRMPipelineStats() {
  await requireAnyPermission(CRM_MODULES);
  // Count leads by status for pipeline display
  const statusGroups = await prisma.lead.groupBy({
    where: { deletedAt: null },
    by: ['status'],
    _count: { _all: true },
    _sum: { expectedValue: true },
  });

  const dealGroups = await prisma.deal.groupBy({
    by: ['stage'],
    where: { deletedAt: null, status: { notIn: ['Lost', 'Cancelled'] } },
    _count: { _all: true },
    _sum: { value: true },
  });

  return { statusGroups, dealGroups };
}

// ─── CUSTOMER ACTIONS ─────────────────────────────────────────────────────────

export async function checkDuplicateCustomer(phone?: string, email?: string) {
  await requireAnyPermission(['leads', 'deals']);
  const where: any = { OR: [] };
  if (phone) where.OR.push({ phone });
  if (email) where.OR.push({ email });
  if (where.OR.length === 0) return null;
  return prisma.customer.findFirst({ where });
}

export async function getCustomers(search?: string) {
  await requireAnyPermission(['leads', 'deals']);
  const where = search ? {
    OR: [
      { name: { contains: search, mode: 'insensitive' as const } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' as const } },
    ]
  } : {};
  return prisma.customer.findMany({
    where,
    include: {
      leads: { select: { id: true, status: true } },
      deals: { select: { id: true, status: true } },
      projects: { select: { id: true, status: true } },
    },
    orderBy: { createdAt: 'desc' }
  });
}

// ─── LEAD ACTIONS ────────────────────────────────────────────────────────────

export async function createLead(formData: {
  customerName: string;
  phone: string;
  email?: string;
  customerType: string;
  existingCustomerId?: string;
  siteLocation?: string;
  propertyType?: string;
  requirement?: string;
  services?: string[];
  budgetRange?: string;
  source?: string;
  priority?: string;
  siteVisitRequired?: boolean;
  notes?: string;
  nextAction?: string;
  expectedValue?: number;
  salesExecutiveId?: string;
}) {
  await requirePermission('leads', 'create');
  const { employee } = await getCurrentEmployee();

  // 1. Create or reuse customer
  let customerId = formData.existingCustomerId;
  if (!customerId) {
    const custCount = await prisma.customer.count();
    const customerCode = generateCustomerCode(custCount);
    const newCustomer = await prisma.customer.create({
      data: {
        customerCode,
        name: formData.customerName,
        phone: formData.phone,
        email: formData.email,
        customerType: formData.customerType,
        status: 'Active',
      }
    });
    customerId = newCustomer.id;
  }

  // 2. Generate lead number
  // One shared, atomic counter for every way of creating a lead (never count-based)
  const leadSeq = await nextLeadSeq(prisma);
  const leadNumber = leadCodeFor(leadSeq);

  // 3. Create lead
  const lead = await prisma.lead.create({
    data: {
      leadNumber,
      leadSeq,
      leadCode: leadNumber,
      customerId,
      propertyType: formData.propertyType,
      siteLocation: formData.siteLocation,
      requirement: formData.requirement,
      services: formData.services ? JSON.stringify(formData.services) : null,
      budgetRange: formData.budgetRange,
      source: formData.source || 'Website',
      priority: formData.priority || 'Medium',
      status: 'New',
      siteVisitRequired: formData.siteVisitRequired,
      notes: formData.notes,
      nextAction: formData.nextAction || 'Call Customer',
      expectedValue: formData.expectedValue,
      salesExecutiveId: formData.salesExecutiveId || employee?.id,
      enquiryDate: new Date(),
    },
    include: { customer: true, salesExecutive: { include: { user: { select: SAFE_USER_SELECT } } } }
  });

  // 4. Audit log
  await createAuditLog({
    entityType: 'Lead',
    entityId: lead.id,
    action: 'Lead Created',
    newValue: { leadNumber, customer: formData.customerName },
    performedById: employee?.id,
    leadId: lead.id,
  });

  // 5. Activity log
  if (employee) {
    await prisma.activity.create({
      data: {
        employeeId: employee.id,
        action: `Created lead ${leadNumber} for ${formData.customerName}`,
        module: 'CRM',
        recordId: lead.id,
      }
    });
  }

  // 6. Auto-create follow-up task
  if (formData.salesExecutiveId || employee?.id) {
    const assigneeId = formData.salesExecutiveId || employee?.id!;
    const fuCount = await prisma.followUp.count();
    await prisma.followUp.create({
      data: {
        followUpNumber: generateFollowUpNumber(fuCount),
        customerId,
        leadId: lead.id,
        assignedToId: assigneeId,
        scheduledDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // tomorrow
        type: 'Call',
        purpose: 'Initial contact for new lead',
        status: 'Pending',
      }
    });
  }

  // 7. Notify sales executive if assigned
  if (formData.salesExecutiveId && formData.salesExecutiveId !== employee?.id) {
    await sendNotification(
      formData.salesExecutiveId,
      'New Lead Assigned',
      `Lead ${leadNumber} (${formData.customerName}) has been assigned to you.`,
      'Info',
      `/crm`
    );
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  revalidatePath('/my-work');

  return { success: true, lead };
}

export async function getLeads(params?: {
  search?: string;
  status?: string;
  source?: string;
  salesExecutiveId?: string;
  page?: number;
  limit?: number;
}) {
  await requirePermission('leads', 'view');
  const { employee } = await getCurrentEmployee();
  const isSalesOnly = isSalesOnlyRole(employee?.user?.role?.name);

  const where: any = { deletedAt: null };
  if (isSalesOnly && employee) {
    where.salesExecutiveId = employee.id;
  }
  if (params?.status) where.status = params.status;
  if (params?.source) where.source = params.source;
  if (params?.salesExecutiveId) where.salesExecutiveId = params.salesExecutiveId;
  if (params?.search) {
    where.OR = [
      { leadNumber: { contains: params.search, mode: 'insensitive' } },
      { customer: { name: { contains: params.search, mode: 'insensitive' } } },
      { customer: { phone: { contains: params.search } } },
      { customer: { email: { contains: params.search, mode: 'insensitive' } } },
      { siteLocation: { contains: params.search, mode: 'insensitive' } },
      { requirement: { contains: params.search, mode: 'insensitive' } },
    ];
  }

  const page = params?.page || 1;
  const limit = params?.limit || 50;

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      include: {
        customer: true,
        salesExecutive: { include: { user: { select: SAFE_USER_SELECT } } },
        deals: { select: { id: true, status: true, value: true } },
        siteVisits: { select: { id: true, status: true, visitDate: true } },
        followUps: { select: { id: true, status: true, scheduledDate: true } },
        quotes: { where: { deletedAt: null }, select: { id: true, status: true, amount: true, type: true } },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.lead.count({ where })
  ]);

  return { leads, total, page, limit };
}

export async function updateLeadStage(leadId: string, newStatus: string) {
  await requirePermission('leads', 'edit');
  const { employee } = await getCurrentEmployee();

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, status: true, leadNumber: true, customerId: true }
  });
  if (!lead) throw new Error('Lead not found');

  const oldStatus = lead.status;

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status: newStatus,
      updatedAt: new Date(),
      ...(newStatus === 'Won' ? { status: 'Won' } : {}),
    }
  });

  await createAuditLog({
    entityType: 'Lead',
    entityId: leadId,
    action: 'Stage Changed',
    oldValue: { status: oldStatus },
    newValue: { status: newStatus },
    performedById: employee?.id,
    leadId,
  });

  if (employee) {
    await prisma.activity.create({
      data: {
        employeeId: employee.id,
        action: `Lead stage changed from ${oldStatus} to ${newStatus}`,
        module: 'CRM',
        recordId: leadId,
      }
    });
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return updated;
}

// ─── FOLLOW-UP ACTIONS ───────────────────────────────────────────────────────

export async function getFollowUps(params?: {
  status?: string;
  assignedToId?: string;
}) {
  await requirePermission('leads', 'view');
  const { employee } = await getCurrentEmployee();
  const where: any = {};
  if (params?.status) where.status = params.status;
  if (params?.assignedToId) where.assignedToId = params.assignedToId;

  return prisma.followUp.findMany({
    where,
    include: {
      customer: true,
      lead: { select: { id: true, leadNumber: true, status: true } },
      deal: { select: { id: true, dealNumber: true, status: true } },
      assignedTo: { include: { user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { scheduledDate: 'asc' }
  });
}

export async function createFollowUp(data: {
  customerId: string;
  leadId?: string;
  dealId?: string;
  assignedToId: string;
  scheduledDate: string;
  type?: string;
  purpose?: string;
  notes?: string;
}) {
  await requirePermission('leads', 'edit');
  const { employee } = await getCurrentEmployee();

  const count = await prisma.followUp.count();
  const followUp = await prisma.followUp.create({
    data: {
      followUpNumber: generateFollowUpNumber(count),
      customerId: data.customerId,
      leadId: data.leadId,
      dealId: data.dealId,
      assignedToId: data.assignedToId,
      scheduledDate: new Date(data.scheduledDate),
      type: data.type || 'Call',
      purpose: data.purpose,
      notes: data.notes,
      status: 'Pending',
    },
    include: { customer: true, assignedTo: { include: { user: { select: SAFE_USER_SELECT } } } }
  });

  if (data.leadId) {
    await createAuditLog({
      entityType: 'FollowUp',
      entityId: followUp.id,
      action: 'Follow-up Created',
      newValue: { type: data.type, date: data.scheduledDate },
      performedById: employee?.id,
      leadId: data.leadId,
    });
  }

  // Notify assigned person
  if (data.assignedToId !== employee?.id) {
    await sendNotification(
      data.assignedToId,
      'New Follow-up Assigned',
      `Follow-up scheduled for ${new Date(data.scheduledDate).toLocaleDateString()} — ${data.purpose || ''}`,
      'Info',
      '/crm'
    );
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  revalidatePath('/my-work');

  return { success: true, followUp };
}

export async function completeFollowUp(followUpId: string, completionNotes?: string) {
  await requirePermission('leads', 'edit');
  const { employee } = await getCurrentEmployee();

  const fu = await prisma.followUp.update({
    where: { id: followUpId },
    data: {
      status: 'Completed',
      completedAt: new Date(),
      completionNotes,
    },
    include: { lead: true }
  });

  if (employee) {
    await prisma.activity.create({
      data: {
        employeeId: employee.id,
        action: `Completed follow-up ${fu.followUpNumber}`,
        module: 'CRM',
        recordId: followUpId,
      }
    });
  }

  if (fu.leadId) {
    await createAuditLog({
      entityType: 'FollowUp',
      entityId: followUpId,
      action: 'Follow-up Completed',
      newValue: { completionNotes },
      performedById: employee?.id,
      leadId: fu.leadId,
    });
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  revalidatePath('/my-work');

  return { success: true };
}

export async function rescheduleFollowUp(followUpId: string, newDate: string, notes?: string) {
  await requirePermission('leads', 'edit');
  const { employee } = await getCurrentEmployee();

  await prisma.followUp.update({
    where: { id: followUpId },
    data: {
      status: 'Rescheduled',
      scheduledDate: new Date(newDate),
      notes,
    }
  });

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true };
}

// ─── SITE VISIT ACTIONS ──────────────────────────────────────────────────────

export async function getSiteVisits(params?: {
  status?: string;
  leadId?: string;
}) {
  await requirePermission('site_visits', 'view');
  const where: any = {};
  if (params?.status) where.status = params.status;
  if (params?.leadId) where.leadId = params.leadId;

  return prisma.siteVisit.findMany({
    where,
    include: {
      lead: { include: { customer: true } },
      employee: { include: { user: { select: SAFE_USER_SELECT } } },
    },
    orderBy: { visitDate: 'asc' }
  });
}

export async function scheduleSiteVisit(data: {
  leadId: string;
  assignedToId: string;
  visitDate: string;
  visitType?: string;
  siteLocation?: string;
  notes?: string;
}) {
  await requirePermission('site_visits', 'create');
  const { employee } = await getCurrentEmployee();

  const count = await prisma.siteVisit.count();
  const siteVisit = await prisma.siteVisit.create({
    data: {
      visitNumber: generateSiteVisitNumber(count),
      leadId: data.leadId,
      assignedTo: data.assignedToId,
      visitDate: new Date(data.visitDate),
      visitType: data.visitType || 'Initial',
      siteLocation: data.siteLocation,
      notes: data.notes,
      status: 'Scheduled',
    },
    include: { lead: { include: { customer: true } }, employee: { include: { user: { select: SAFE_USER_SELECT } } } }
  });

  // Update lead status
  await prisma.lead.update({
    where: { id: data.leadId },
    data: { status: 'Site Visit Scheduled' }
  });

  await createAuditLog({
    entityType: 'SiteVisit',
    entityId: siteVisit.id,
    action: 'Site Visit Scheduled',
    newValue: { date: data.visitDate, assignedTo: data.assignedToId },
    performedById: employee?.id,
    leadId: data.leadId,
  });

  // Notify assigned employee
  if (data.assignedToId !== employee?.id) {
    await sendNotification(
      data.assignedToId,
      'Site Visit Assigned',
      `Site visit scheduled on ${new Date(data.visitDate).toLocaleDateString()} — ${siteVisit.lead?.customer?.name}`,
      'Info',
      '/crm'
    );
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true, siteVisit };
}

export async function completeSiteVisit(visitId: string, data: {
  visitNotes?: string;
  requirements?: string;
  measurements?: string;
  nextAction?: string;
}) {
  await requirePermission('site_visits', 'edit');
  const { employee } = await getCurrentEmployee();

  const sv = await prisma.siteVisit.update({
    where: { id: visitId },
    data: {
      status: 'Completed',
      completedAt: new Date(),
      actualDate: new Date(),
      visitNotes: data.visitNotes,
      requirements: data.requirements,
      measurements: data.measurements,
    },
    include: { lead: true }
  });

  if (sv.leadId) {
    await prisma.lead.update({
      where: { id: sv.leadId },
      data: {
        status: 'Site Visit Completed',
        nextAction: data.nextAction || 'Create Preliminary Quote',
      }
    });
  }

  await createAuditLog({
    entityType: 'SiteVisit',
    entityId: visitId,
    action: 'Site Visit Completed',
    newValue: data,
    performedById: employee?.id,
    leadId: sv.leadId || undefined,
  });

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true };
}

// ─── DEAL ACTIONS ────────────────────────────────────────────────────────────

export async function getDeals(params?: {
  status?: string;
  stage?: string;
  salesExecutiveId?: string;
}) {
  await requirePermission('deals', 'view');
  const { employee } = await getCurrentEmployee();
  const isSalesOnly = isSalesOnlyRole(employee?.user?.role?.name);

  const where: any = { deletedAt: null };
  if (isSalesOnly && employee) where.salesExecutiveId = employee.id;
  if (params?.status) where.status = params.status;
  if (params?.stage) where.stage = params.stage;
  if (params?.salesExecutiveId) where.salesExecutiveId = params.salesExecutiveId;

  return prisma.deal.findMany({
    where,
    include: {
      customer: true,
      lead: { select: { id: true, leadNumber: true } },
      salesExecutive: { include: { user: { select: SAFE_USER_SELECT } } },
      quotes: { where: { deletedAt: null }, select: { id: true, quoteNumber: true, amount: true, status: true, type: true } },
      projects: { select: { id: true, name: true, status: true } },
    },
    orderBy: { updatedAt: 'desc' }
  });
}

export async function createDeal(data: {
  leadId: string;
  title: string;
  value: number;
  expectedCloseDate?: string;
  probability?: number;
  salesExecutiveId?: string;
}) {
  await requirePermission('deals', 'create');
  const { employee } = await getCurrentEmployee();

  const lead = await prisma.lead.findUnique({
    where: { id: data.leadId },
    select: { customerId: true, leadNumber: true }
  });
  if (!lead) throw new Error('Lead not found');

  const count = await prisma.deal.count();
  const deal = await prisma.deal.create({
    data: {
      dealNumber: generateDealNumber(count),
      leadId: data.leadId,
      customerId: lead.customerId,
      title: data.title,
      value: data.value,
      probability: data.probability || 50,
      stage: 'Qualification',
      status: 'Open',
      expectedCloseDate: data.expectedCloseDate ? new Date(data.expectedCloseDate) : null,
      salesExecutiveId: data.salesExecutiveId || employee?.id,
    }
  });

  await prisma.lead.update({
    where: { id: data.leadId },
    data: { status: 'Negotiation' }
  });

  await createAuditLog({
    entityType: 'Deal',
    entityId: deal.id,
    action: 'Deal Created',
    newValue: { dealNumber: deal.dealNumber, value: data.value },
    performedById: employee?.id,
    leadId: data.leadId,
    dealId: deal.id,
  });

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true, deal };
}

export async function updateDealStage(dealId: string, newStage: string, data?: {
  probability?: number;
  lostReason?: string;
}) {
  await requirePermission('deals', 'edit');
  const { employee } = await getCurrentEmployee();

  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) throw new Error('Deal not found');

  const isWon = newStage === 'Won';
  const isLost = newStage === 'Lost';

  const updated = await prisma.deal.update({
    where: { id: dealId },
    data: {
      stage: newStage,
      status: isWon ? 'Won' : isLost ? 'Lost' : 'Open',
      wonAt: isWon ? new Date() : undefined,
      lostReason: isLost ? data?.lostReason : undefined,
      probability: data?.probability ?? (isWon ? 100 : isLost ? 0 : deal.probability),
    }
  });

  await createAuditLog({
    entityType: 'Deal',
    entityId: dealId,
    action: isWon ? 'Deal Won' : isLost ? 'Deal Lost' : 'Stage Changed',
    oldValue: { stage: deal.stage },
    newValue: { stage: newStage },
    performedById: employee?.id,
    dealId,
  });

  if (isWon && employee) {
    // Find manager to notify
    const managers = await prisma.employee.findMany({
      where: {
        user: {
          OR: [
            { isSuperAdmin: true },
            { role: { name: { in: ['Sales Manager', 'Director', 'CEO / Founder'] } } },
          ],
        }
      },
      select: { id: true }
    });
    for (const mgr of managers) {
      await sendNotification(
        mgr.id,
        'Deal Won! 🎉',
        `${deal.title} has been won. Value: ₹${Number(deal.value).toLocaleString('en-IN')}`,
        'Success',
        '/crm'
      );
    }
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true, deal: updated };
}

export async function convertDealToProject(dealId: string, projectData: {
  name: string;
  managerId: string;
  startDate?: string;
  expectedEndDate?: string;
}) {
  await requirePermission('deals', 'edit');
  await requirePermission('projects', 'create');
  const { employee } = await getCurrentEmployee();

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: {
      customer: true,
      lead: true,
      quotes: {
        where: { status: 'Accepted', deletedAt: null },
        include: { lineItems: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    }
  });
  if (!deal) throw new Error('Deal not found');
  if (deal.status !== 'Won') throw new Error('Deal must be Won to convert to project');

  // Check if project already exists for this deal
  const existingProject = await prisma.project.findFirst({ where: { dealId } });
  if (existingProject) throw new Error('Project already exists for this deal');

  // Use a transaction
  const project = await prisma.$transaction(async (tx) => {
    // 1. Create SalesOrder if best quote exists
    let salesOrderId: string | undefined;
    const bestQuote = deal.quotes[0];
    if (bestQuote) {
      const so = await tx.salesOrder.create({
        data: {
          quoteId: bestQuote.id,
          amount: bestQuote.amount,
          status: 'Confirmed',
        }
      });
      salesOrderId = so.id;
    }

    // 2. Create Project
    const proj = await tx.project.create({
      data: {
        name: projectData.name,
        customerId: deal.customerId,
        leadId: deal.leadId,
        dealId: deal.id,
        salesOrderId,
        managerId: projectData.managerId,
        status: 'Planning',
        value: deal.value,
        startDate: projectData.startDate ? new Date(projectData.startDate) : new Date(),
        expectedEndDate: projectData.expectedEndDate ? new Date(projectData.expectedEndDate) : null,
      }
    });

    // 3. Convert quote line items to BOQ items
    if (bestQuote?.lineItems?.length) {
      for (const item of bestQuote.lineItems) {
        const boq = await tx.boqItem.create({
          data: {
            projectId: proj.id,
            category: item.category,
            item: item.name ? [item.name, item.description].filter(Boolean).join(' - ') : item.description,
            quantity: item.quantity,
            unit: item.unit,
            rate: item.rate,
            amount: item.amount,
            quoteItemId: item.id,
          }
        });
        // Update quote item with boq reference
        await tx.quoteItem.update({
          where: { id: item.id },
          data: { boqItemId: boq.id }
        });
      }
    }

    // 4. Create initial project task
    if (employee) {
      await tx.task.create({
        data: {
          title: `Project Kickoff — ${projectData.name}`,
          taskType: 'project',
          description: `Initialize project for deal ${deal.dealNumber}`,
          projectId: proj.id,
          assigneeId: projectData.managerId,
          leadId: deal.leadId,
          customerId: deal.customerId,
          dealId: deal.id,
          priority: 'High',
          status: 'Not Started',
          dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        }
      });
    }

    return proj;
  });

  await createAuditLog({
    entityType: 'Deal',
    entityId: dealId,
    action: 'Converted to Project',
    newValue: { projectId: project.id, projectName: projectData.name },
    performedById: employee?.id,
    dealId,
  });

  if (employee) {
    await prisma.activity.create({
      data: {
        employeeId: employee.id,
        action: `Deal ${deal.dealNumber} converted to project: ${projectData.name}`,
        module: 'CRM',
        recordId: dealId,
      }
    });
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  revalidatePath('/projects');
  revalidatePath('/my-work');

  return { success: true, projectId: project.id };
}

// ─── QUOTE ACTIONS ───────────────────────────────────────────────────────────

export async function getQuotes(params?: { status?: string; dealId?: string; leadId?: string }) {
  await requirePermission('quotes', 'view');
  const where: any = { deletedAt: null };
  if (params?.status) where.status = params.status;
  if (params?.dealId) where.dealId = params.dealId;
  if (params?.leadId) where.leadId = params.leadId;

  return prisma.quote.findMany({
    where,
    include: {
      customer: true,
      lead: { select: { id: true, leadNumber: true } },
      deal: { select: { id: true, dealNumber: true } },
      createdBy: { include: { user: { select: SAFE_USER_SELECT } } },
      lineItems: true,
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function createQuote(data: {
  leadId?: string;
  dealId?: string;
  customerId?: string;
  type: 'Preliminary' | 'Final';
  amount: number;
  expiryDate?: string;
  notes?: string;
  lineItems: Array<{
    category: string;
    description: string;
    quantity?: number;
    unit?: string;
    rate: number;
    amount: number;
  }>;
}) {
  await requirePermission('quotes', 'create');
  const { employee } = await getCurrentEmployee();

  const count = await prisma.quote.count();
  const quote = await prisma.quote.create({
    data: {
      quoteNumber: generateQuoteNumber(count),
      leadId: data.leadId,
      dealId: data.dealId,
      customerId: data.customerId,
      type: data.type,
      amount: data.amount,
      status: 'Draft',
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
      notes: data.notes,
      createdById: employee?.id,
      lineItems: {
        create: data.lineItems.map(item => ({
          category: item.category,
          description: item.description,
          quantity: item.quantity || 1,
          unit: item.unit || 'nos',
          rate: item.rate,
          amount: item.amount,
        }))
      }
    },
    include: { lineItems: true }
  });

  if (data.leadId) {
    await createAuditLog({
      entityType: 'Quote',
      entityId: quote.id,
      action: 'Quote Created',
      newValue: { quoteNumber: quote.quoteNumber, type: data.type, amount: data.amount },
      performedById: employee?.id,
      leadId: data.leadId,
      quoteId: quote.id,
    });
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true, quote };
}

export async function updateQuoteStatus(quoteId: string, status: string) {
  await requirePermission('quotes', 'edit');
  const { employee } = await getCurrentEmployee();

  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: { status },
    include: { lead: true }
  });

  if (status === 'Accepted' && quote.leadId) {
    await prisma.lead.update({
      where: { id: quote.leadId },
      data: {
        status: quote.type === 'Preliminary' ? 'Preliminary Quote Sent' : 'Final Quote Sent',
        prelimQuoteStatus: quote.type === 'Preliminary' ? 'Accepted' : undefined,
      }
    });
  }

  await createAuditLog({
    entityType: 'Quote',
    entityId: quoteId,
    action: `Quote ${status}`,
    newValue: { status },
    performedById: employee?.id,
    leadId: quote.leadId || undefined,
    quoteId,
  });

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return { success: true };
}

// ─── IMPORT LEADS ────────────────────────────────────────────────────────────

export async function importLeads(rows: Array<{
  customerName: string;
  phone?: string;
  email?: string;
  location?: string;
  requirement?: string;
  budget?: string;
  customerType?: string;
  source?: string;
  assignedEmployee?: string;
}>) {
  await requirePermission('leads', 'create');
  const { employee } = await getCurrentEmployee();
  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const row of rows) {
    try {
      if (!row.customerName?.trim()) {
        results.errors.push(`Row skipped: Missing customer name`);
        results.skipped++;
        continue;
      }

      // Check for duplicate by phone or email
      const existing = await prisma.customer.findFirst({
        where: {
          OR: [
            row.phone ? { phone: row.phone } : { id: 'impossible' },
            row.email ? { email: row.email } : { id: 'impossible' },
          ].filter(Boolean)
        }
      });

      let customerId = existing?.id;
      if (!customerId) {
        const custCount = await prisma.customer.count();
        const newCust = await prisma.customer.create({
          data: {
            customerCode: generateCustomerCode(custCount),
            name: row.customerName.trim(),
            phone: row.phone,
            email: row.email,
            address: row.location,
            customerType: row.customerType || 'Individual',
          }
        });
        customerId = newCust.id;
      }

      const leadSeq = await nextLeadSeq(prisma);
      await prisma.lead.create({
        data: {
          leadNumber: leadCodeFor(leadSeq),
          leadSeq,
          leadCode: leadCodeFor(leadSeq),
          customerId,
          siteLocation: row.location,
          requirement: row.requirement,
          budgetRange: row.budget,
          source: row.source || 'Import',
          status: 'New',
          salesExecutiveId: employee?.id,
        }
      });

      results.imported++;
    } catch (err: any) {
      results.errors.push(`Row failed: ${err.message}`);
      results.skipped++;
    }
  }

  revalidatePath('/crm');

  revalidateTag(CRM_STATS_TAG, { expire: 0 });
  return results;
}

// ─── AUDIT LOG ───────────────────────────────────────────────────────────────

export async function getLeadAuditLog(leadId: string) {
  await requirePermission('leads', 'view');
  return prisma.cRMAuditLog.findMany({
    where: { leadId },
    include: { performedBy: { include: { user: { select: SAFE_USER_SELECT } } } },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getDealAuditLog(dealId: string) {
  await requirePermission('deals', 'view');
  return prisma.cRMAuditLog.findMany({
    where: { dealId },
    include: { performedBy: { include: { user: { select: SAFE_USER_SELECT } } } },
    orderBy: { createdAt: 'desc' }
  });
}

// ─── GET EMPLOYEES (for dropdowns) ───────────────────────────────────────────

export async function getCRMEmployees() {
  await requireAnyPermission(CRM_MODULES);
  return prisma.employee.findMany({
    include: { user: { select: SAFE_USER_SELECT } },
    orderBy: { user: { name: 'asc' } }
  });
}
