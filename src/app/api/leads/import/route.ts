import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readJson, withAuthRoute } from "@/lib/api";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";
import { nextCustomerCode } from "@/lib/customers/numbering";
import { nextLeadSeq, leadCodeFor, TX } from "@/lib/leads/service";
import { normalizePhone } from "@/lib/leads/format";
import { getField, looselySame, normalizeStr, parseAmount, parseImportDate } from "@/lib/import/sheet";
import { matchUser } from "@/lib/import/people";
import { describeRowFailure, IMPORT_BUDGET_MS, importBody } from "@/lib/import/body";

// One request imports one batch of rows (the upload dialog reads the file and sends them a few at a time), so it finishes in time.
export const maxDuration = 60;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// POST /api/leads/import
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    if (!hasPermission(ctx.permissions, "leads", "create")) {
      throw new ServiceError(403, "You do not have permission to import leads.");
    }
    const { rows: rawRows, duplicateStrategy, rowOffset } = await readJson(request, importBody);
    // Changing the leads that exist is editing them, not creating
    if (duplicateStrategy === "update" && !hasPermission(ctx.permissions, "leads", "edit")) {
      throw new ServiceError(403, "You do not have permission to edit leads.");
    }
    const started = Date.now();

    // 1. Preload reference caches
    const [employees, allOptions, existingLeads] = await Promise.all([
      prisma.employee.findMany({
        where: { user: { deletedAt: null } },
        select: {
          id: true,
          employeeCode: true,
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.leadOption.findMany({
        where: { isActive: true },
        select: { id: true, type: true, label: true, key: true, parentId: true },
      }),
      prisma.lead.findMany({
        where: { deletedAt: null },
        select: { id: true, leadNumber: true, leadCode: true },
      }),
    ]);

    // Memory caches. createdOptionKeys: the options the current row added, removed again if the row fails
    const createdOptionKeys: string[] = [];
    const leadOptionCache = new Map<string, { id: string; label: string; parentId: string | null }>();
    for (const opt of allOptions) {
      leadOptionCache.set(`${opt.type}::${normalizeStr(opt.label)}`, {
        id: opt.id,
        label: opt.label,
        parentId: opt.parentId,
      });
    }

    const leadMap = new Map<string, string>(); // leadNumber/code -> leadId
    for (const l of existingLeads) {
      if (l.leadNumber) leadMap.set(l.leadNumber.toLowerCase().trim(), l.id);
      if (l.leadCode) leadMap.set(l.leadCode.toLowerCase().trim(), l.id);
    }

    // Helper: Match employee (by name, employee code or e-mail; see lib/import/people.ts)
    const people = employees.map(e => ({ id: e.id, name: e.user?.name ?? null, email: e.user?.email ?? null, employeeCode: e.employeeCode }));
    const matchEmployee = (str: string): string | null => matchUser(people, str);

    // Helper: Find or create option
    const resolveOption = async (
      tx: Prisma.TransactionClient,
      type: string,
      rawLabel: string,
      parentId?: string | null
    ): Promise<string | null> => {
      if (!rawLabel || !rawLabel.trim()) return null;
      const label = rawLabel.trim();
      const norm = normalizeStr(label);
      if (!norm) return null; // "-" or "?" is no choice
      const cacheKey = `${type}::${norm}`;

      const existing = leadOptionCache.get(cacheKey);
      if (existing) return existing.id;

      // A partial match counts when it is the same words ("Instagram" for "Instagram Ads"), never part of a word
      for (const [key, opt] of leadOptionCache.entries()) {
        if (key.startsWith(`${type}::`)) {
          const optNorm = key.slice(type.length + 2);
          if (looselySame(optNorm, norm)) return opt.id;
        }
      }

      // Create new option
      const newOption = await tx.leadOption.create({
        data: {
          type,
          label,
          key: slugify(label),
          parentId: parentId || null,
        },
      });

      leadOptionCache.set(cacheKey, { id: newOption.id, label: newOption.label, parentId: newOption.parentId });
      createdOptionKeys.push(cacheKey);
      return newOption.id;
    };

    // Helper: Find or create customer
    const resolveCustomer = async (
      tx: Prisma.TransactionClient,
      customerName: string,
      contactNumber: string
    ): Promise<string> => {
      const name = customerName.trim() || "Imported Lead Customer";
      const phoneDigits = contactNumber.replace(/\D/g, "");

      if (phoneDigits.length >= 7) {
        const existing = await tx.customer.findFirst({
          where: {
            OR: [
              { phone: contactNumber },
              { phone: { contains: phoneDigits.slice(-10) } },
            ],
          },
          select: { id: true },
        });
        if (existing) return existing.id;
      }

      // Check by name if phone not found
      const byName = await tx.customer.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (byName) return byName.id;

      const code = await nextCustomerCode(tx);
      const created = await tx.customer.create({
        data: {
          name,
          phone: contactNumber || null,
          customerCode: code,
          customerType: "Individual",
        },
        select: { id: true },
      });
      return created.id;
    };

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const errors: { row: number; leadNumber: string; customerName: string; reason: string }[] = [];

    let processed = 0;
    for (let i = 0; i < rawRows.length; i++) {
      if (Date.now() - started > IMPORT_BUDGET_MS) break;
      processed = i + 1;
      const rowIdx = rowOffset + i + 2; // the line in the file (line 1 holds the headings)
      const r = rawRows[i];

      // Extract fields
      const recordId = getField(r, "Record Id", "RecordId", "zcrmId");
      const leadNumberRaw = getField(r, "Lead Number", "LeadNumber", "Lead ID", "LeadCode", "code");
      const dateStr = getField(r, "Date", "Enquiry Date", "Created Date", "createdAt");
      const customerName = getField(r, "Lead Name", "LeadName", "Customer Name", "Customer", "Name");
      const phoneRaw = getField(r, "Phone", "Contact Number", "Mobile");
      const leadStatusStr = getField(r, "Lead Status", "LeadStatus", "Status");
      const taskPersonStr = getField(r, "Task Person", "TaskPerson", "Task Assigned Person");
      const taskPersonId = getField(r, "Task Person.id", "TaskPerson.id");
      const modifiedTimeStr = getField(r, "Modified Time", "ModifiedTime", "Updated At", "updatedAt");
      const nextFollowupStr = getField(r, "Next Followup Date", "NextFollowupDate", "Next Action Date");
      const typeOfLeadStr = getField(r, "Type of Lead", "TypeOfLead", "Lead Priority", "Priority");
      const requirements = getField(r, "Requirements", "Exact Requirement", "Requirement");
      const city = getField(r, "City", "Location", "Site Location");
      const assignedPersonStr = getField(r, "Assigned Person", "AssignedPerson", "Lead Person");
      const assignedPersonId = getField(r, "Assigned Person.id", "AssignedPerson.id");
      const leadSourceStr = getField(r, "Lead Source", "LeadSource", "Source");
      const categoryStr = getField(r, "Category", "Main Category", "MainCategory");
      const subCategoryStr = getField(r, "Sub Category", "SubCategory", "Subcategory");
      const leadTypeStr = getField(r, "Lead Type", "LeadType", "Product or Service", "ProductOrService");
      const avgTimeSpent = getField(r, "Average Time Spent (Minutes)", "Average Time Spent", "Time Spent");
      const locationLink = getField(r, "Location Link", "LocationLink", "Map Link");
      const lastActivityStr = getField(r, "Last Activity Time", "LastActivityTime", "Last Contacted");
      const notes = getField(r, "Notes", "Remarks", "Description");
      const amountStr = getField(r, "Amount", "Value", "Deal Value");
      const convRateStr = getField(r, "Conventional Rate", "Conventional Rate %");

      // Skip empty rows
      if (!leadNumberRaw && !customerName && !phoneRaw && !requirements) {
        continue;
      }

      // A lead number that is already a lead is skipped before any database work
      const leadNumber = leadNumberRaw.trim();
      const existingId = leadNumber ? leadMap.get(leadNumber.toLowerCase()) : null;
      if (existingId && duplicateStrategy === "skip") {
        skippedCount++;
        continue;
      }
      const updating = !!existingId && duplicateStrategy === "update";

      // One transaction per row: a row that fails leaves the others alone. The caches change only when the row was saved.
      const afterCommit: (() => void)[] = [];
      createdOptionKeys.length = 0;
      try {
        const outcome = await prisma.$transaction(async tx => {
          // Resolve dates
          const enquiryDate = parseImportDate(dateStr) || new Date();
          const createdAt = enquiryDate;
          const updatedAt = parseImportDate(modifiedTimeStr) || createdAt;
          const nextActionDate = parseImportDate(nextFollowupStr);
          const lastContactedAt = parseImportDate(lastActivityStr) || updatedAt;

          // Normalize phone
          const phone = normalizePhone(phoneRaw) || phoneRaw.replace(/[^\d+]/g, "").trim() || "";

          // Resolve customer
          // An update leaves the customer link alone, so it must not create a customer either
          const customerId = updating ? "" : await resolveCustomer(tx, customerName, phone);

          // Resolve options
          const mainCategoryId = await resolveOption(tx, "MAIN_CATEGORY", categoryStr);
          const subcategoryId = subCategoryStr
            ? await resolveOption(tx, "SUBCATEGORY", subCategoryStr, mainCategoryId)
            : null;
          const leadStatusId = await resolveOption(tx, "LEAD_STATUS", leadStatusStr);
          const sourceId = await resolveOption(tx, "SOURCE", leadSourceStr);
          const leadTypeId = await resolveOption(tx, "LEAD_TYPE", typeOfLeadStr);
          
          // Lead Type in Zoho format: "Product Supply" -> Product, "Service & AMC" -> Service
          let productOrServiceId: string | null = null;
          if (leadTypeStr) {
            const normLt = normalizeStr(leadTypeStr);
            if (normLt.includes("product")) {
              productOrServiceId = await resolveOption(tx, "PRODUCT_OR_SERVICE", "Product");
            } else if (normLt.includes("service")) {
              productOrServiceId = await resolveOption(tx, "PRODUCT_OR_SERVICE", "Service");
            } else {
              productOrServiceId = await resolveOption(tx, "PRODUCT_OR_SERVICE", leadTypeStr);
            }
          }

          // Resolve employees
          const salesExecutiveId = matchEmployee(taskPersonStr) || null;
          const leadPersonId = matchEmployee(assignedPersonStr) || salesExecutiveId || ctx.employeeId || null;

          // Closed / converted status
          const normStatus = normalizeStr(leadStatusStr);
          const isClosed = normStatus === "closed" || normStatus === "lost lead";
          const isConverted = normStatus === "deal converted";
          const closedAt = isClosed ? updatedAt : null;
          const convertedAt = isConverted ? updatedAt : null;
          const statusText = isConverted ? "Won" : isClosed ? "Closed" : "New";

          // Amount
          const parsedAmount = parseAmount(amountStr);
          const amount = parsedAmount !== null && parsedAmount >= 0 ? new Prisma.Decimal(parsedAmount) : null;
          const parsedRate = parseAmount(convRateStr);
          const conventionalRate = parsedRate !== null && parsedRate >= 0 ? new Prisma.Decimal(parsedRate) : null;

          const customFieldsData: Record<string, unknown> = {};
          if (recordId) customFieldsData.zcrmRecordId = recordId;
          if (taskPersonId) customFieldsData.zcrmTaskPersonId = taskPersonId;
          if (taskPersonStr) customFieldsData.taskPersonName = taskPersonStr;
          if (assignedPersonId) customFieldsData.zcrmAssignedPersonId = assignedPersonId;
          if (assignedPersonStr) customFieldsData.assignedPersonName = assignedPersonStr;
          if (avgTimeSpent) customFieldsData.avgTimeSpent = avgTimeSpent;

          if (existingId && duplicateStrategy === "update") {
            // UPDATE existing lead (the custom fields it already has stay; the file adds to them)
            const before = await tx.lead.findUnique({ where: { id: existingId }, select: { customFields: true } });
            const oldCustom =
              before?.customFields && typeof before.customFields === "object" && !Array.isArray(before.customFields) ? before.customFields : {};
            await tx.lead.update({
              where: { id: existingId },
              data: {
                customerName: customerName || undefined,
                contactNumber: phone || undefined,
                exactRequirement: requirements || undefined,
                requirement: requirements || undefined,
                location: city || undefined,
                siteLocation: city || undefined,
                locationLink: locationLink || undefined,
                source: leadSourceStr || undefined,
                sourceId: sourceId || undefined,
                mainCategoryId: mainCategoryId || undefined,
                subcategoryId: subcategoryId || undefined,
                leadStatusId: leadStatusId || undefined,
                ...(leadStatusStr ? { status: statusText, closedAt, convertedAt } : {}),
                leadTypeId: leadTypeId || undefined,
                productOrServiceId: productOrServiceId || undefined,
                salesExecutiveId: salesExecutiveId || undefined,
                leadPersonId: leadPersonId || undefined,
                notes: notes || undefined,
                amount: amount || undefined,
                expectedValue: amount || undefined,
                conventionalRate: conventionalRate || undefined,
                nextActionDate: nextActionDate || undefined,
                lastContactedAt: lastActivityStr || modifiedTimeStr ? lastContactedAt : undefined,
                updatedAt,
                updatedById: ctx.userId,
                customFields: Object.keys(customFieldsData).length
                  ? ({ ...oldCustom, ...customFieldsData } as Prisma.InputJsonObject)
                  : undefined,
              },
            });
            return "updated" as const;
          } else {
            // CREATE new lead
            const seq = await nextLeadSeq(tx);
            const generatedCode = leadCodeFor(seq);

            // Ensure leadCode & leadNumber uniqueness
            let finalLeadNumber = leadNumber || generatedCode;
            let finalLeadCode = leadNumber || generatedCode;

            if (leadMap.has(finalLeadNumber.toLowerCase()) && duplicateStrategy === "create_new") {
              finalLeadNumber = `${finalLeadNumber}-${seq}`;
              finalLeadCode = `${finalLeadCode}-${seq}`;
            }

            const createdLead = await tx.lead.create({
              data: {
                customerId,
                leadSeq: seq,
                leadCode: finalLeadCode,
                leadNumber: finalLeadNumber,
                customerName,
                contactNumber: phone,
                exactRequirement: requirements || null,
                requirement: requirements || null,
                location: city || null,
                siteLocation: city || null,
                locationLink: locationLink || null,
                source: leadSourceStr || null,
                sourceId,
                mainCategoryId,
                subcategoryId,
                leadStatusId,
                status: statusText,
                closedAt,
                convertedAt,
                leadTypeId,
                productOrServiceId,
                salesExecutiveId,
                leadPersonId,
                notes: notes || null,
                amount,
                expectedValue: amount,
                conventionalRate,
                enquiryDate,
                nextActionDate,
                lastContactedAt,
                createdAt,
                updatedAt,
                createdById: ctx.userId,
                updatedById: ctx.userId,
                customFields: Object.keys(customFieldsData).length
                  ? (customFieldsData as Prisma.InputJsonObject)
                  : Prisma.DbNull,
              },
            });

            // Create initial follow-up record if next follow-up date was supplied
            if (nextActionDate) {
              await tx.leadFollowUp.create({
                data: {
                  leadId: createdLead.id,
                  notes: "Scheduled follow-up from import",
                  nextAt: nextActionDate,
                  completedAt: lastContactedAt || createdAt,
                  createdAt,
                  createdById: ctx.userId,
                },
              });
            }

            afterCommit.push(() => {
              leadMap.set(finalLeadNumber.toLowerCase(), createdLead.id);
              leadMap.set(finalLeadCode.toLowerCase(), createdLead.id);
            });
            return "created" as const;
          }
        }, TX);
        afterCommit.forEach(apply => apply());
        if (outcome === "created") importedCount++;
        else updatedCount++;
      } catch (rowErr) {
        for (const key of createdOptionKeys) leadOptionCache.delete(key);
        console.error("leads import: row failed", rowIdx, rowErr);
        errors.push({
          row: rowIdx,
          leadNumber: leadNumberRaw || "—",
          customerName: customerName || "—",
          reason: describeRowFailure(rowErr),
        });
      }
    }

    // Audit log
    if (importedCount > 0 || updatedCount > 0) {
      await prisma.cRMAuditLog.create({
        data: {
          entityType: "Lead",
          entityId: "bulk-import",
          action: "Imported",
          performedById: ctx.employeeId,
          newValue: JSON.stringify({
            total: processed,
            imported: importedCount,
            updated: updatedCount,
            skipped: skippedCount,
          }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      processed,
      imported: importedCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors,
    });
  });
}
