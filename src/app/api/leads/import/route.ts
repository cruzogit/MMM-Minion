import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { withAuthRoute, jsonError } from "@/lib/api";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";
import { nextCustomerCode } from "@/lib/customers/numbering";
import { nextLeadSeq, leadCodeFor, audit, TX } from "@/lib/leads/service";
import { normalizePhone } from "@/lib/leads/format";

export const maxDuration = 60; // Allow sufficient time for large bulk imports

function normalizeStr(s: unknown): string {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getField(row: Record<string, unknown>, ...aliases: string[]): string {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const k of keys) {
      const cleanKey = k.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (cleanKey === cleanAlias) {
        const val = row[k];
        if (val !== undefined && val !== null) {
          const str = String(val).trim();
          if (str) return str;
        }
      }
    }
  }
  return "";
}

function parseImportDate(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val.getTime())) {
    if (val.getFullYear() < 2000) return null; // Ignore 1899 epoch
    return val;
  }
  const str = String(val).trim();
  if (!str || str === "1899-12-31" || str === "-" || str === "—") return null;

  // Check Excel serial number (numeric, e.g. 45000 to 55000)
  if (/^\d{5}(\.\d+)?$/.test(str)) {
    const num = parseFloat(str);
    const d = new Date(Math.round((num - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
  }

  // Check ISO / standard YYYY-MM-DD
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
  }

  // Check M/D/YY or M/D/YYYY or D/M/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (slashMatch) {
    const [, p1, p2, pYear, hour = "0", min = "0", sec = "0"] = slashMatch;
    let y = parseInt(pYear, 10);
    if (y < 100) y += 2000;
    const n1 = parseInt(p1, 10);
    const n2 = parseInt(p2, 10);
    let month = n1 - 1;
    let day = n2;
    if (n1 > 12 && n2 <= 12) {
      day = n1;
      month = n2 - 1;
    }
    const d = new Date(y, month, day, parseInt(hour, 10), parseInt(min, 10), parseInt(sec, 10));
    if (!isNaN(d.getTime()) && d.getFullYear() >= 2000) return d;
  }

  const fallback = new Date(str);
  if (!isNaN(fallback.getTime()) && fallback.getFullYear() >= 2000) return fallback;
  return null;
}

// POST /api/leads/import
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    if (!hasPermission(ctx.permissions, "leads", "create")) {
      throw new ServiceError(403, "You do not have permission to import leads.");
    }

    let rawRows: Record<string, unknown>[] = [];
    let duplicateStrategy: "skip" | "update" | "create_new" = "skip";

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file") as File | null;
      const strategy = formData.get("duplicateStrategy") as string | null;
      if (strategy === "update" || strategy === "create_new" || strategy === "skip") {
        duplicateStrategy = strategy;
      }

      if (!file) {
        return jsonError(400, "Please upload a CSV or Excel (.xlsx) file.");
      }

      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      const workbook = XLSX.read(buffer, { type: "buffer" });
      if (!workbook.SheetNames.length) {
        return jsonError(400, "The uploaded file contains no sheets.");
      }
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      rawRows = Array.isArray(body.rows) ? body.rows : [];
      if (body.duplicateStrategy === "update" || body.duplicateStrategy === "create_new" || body.duplicateStrategy === "skip") {
        duplicateStrategy = body.duplicateStrategy;
      }
    } else {
      return jsonError(400, "Unsupported Content-Type. Please upload a file via multipart/form-data.");
    }

    if (!rawRows.length) {
      return jsonError(400, "The file contains no data rows.");
    }

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

    // Memory caches
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

    // Helper: Match employee
    const matchEmployee = (str: string): string | null => {
      if (!str) return null;
      // 1. Try matching trailing 2-4 digit code (e.g. "Kiruba 015" -> "015")
      const numMatch = str.match(/\b(\d{2,4})\b/);
      if (numMatch) {
        const codeNum = numMatch[1];
        const byCode = employees.find(e => e.employeeCode && e.employeeCode.endsWith(codeNum));
        if (byCode) return byCode.id;
      }
      // 2. Try normalized name match
      const norm = normalizeStr(str);
      const byName = employees.find(e => {
        const eNorm = normalizeStr(e.user?.name);
        return eNorm && (norm.includes(eNorm) || eNorm.includes(norm));
      });
      if (byName) return byName.id;
      return null;
    };

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
      const cacheKey = `${type}::${norm}`;

      const existing = leadOptionCache.get(cacheKey);
      if (existing) return existing.id;

      // Check for partial/fuzzy match among existing options of that type
      for (const [key, opt] of leadOptionCache.entries()) {
        if (key.startsWith(`${type}::`)) {
          const optNorm = key.slice(type.length + 2);
          if (optNorm === norm || (optNorm.length > 3 && (optNorm.includes(norm) || norm.includes(optNorm)))) {
            return opt.id;
          }
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

      if (phoneDigits) {
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

    // Process in chunks of 50
    const CHUNK_SIZE = 50;
    for (let chunkStart = 0; chunkStart < rawRows.length; chunkStart += CHUNK_SIZE) {
      const chunk = rawRows.slice(chunkStart, chunkStart + CHUNK_SIZE);

      await prisma.$transaction(
        async tx => {
          for (let i = 0; i < chunk.length; i++) {
            const rowIdx = chunkStart + i + 1;
            const r = chunk[i];

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

            try {
              const leadNumber = leadNumberRaw.trim();
              const existingId = leadNumber ? leadMap.get(leadNumber.toLowerCase()) : null;

              if (existingId) {
                if (duplicateStrategy === "skip") {
                  skippedCount++;
                  continue;
                }
              }

              // Resolve dates
              const enquiryDate = parseImportDate(dateStr) || new Date();
              const createdAt = enquiryDate;
              const updatedAt = parseImportDate(modifiedTimeStr) || createdAt;
              const nextActionDate = parseImportDate(nextFollowupStr);
              const lastContactedAt = parseImportDate(lastActivityStr) || updatedAt;

              // Normalize phone
              const phone = normalizePhone(phoneRaw) || phoneRaw.replace(/[^\d+]/g, "").trim() || "";

              // Resolve customer
              const customerId = await resolveCustomer(tx, customerName, phone);

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
              let amount: Prisma.Decimal | null = null;
              if (amountStr) {
                const num = parseFloat(amountStr.replace(/[^0-9.]/g, ""));
                if (!isNaN(num)) amount = new Prisma.Decimal(num);
              }
              let conventionalRate: Prisma.Decimal | null = null;
              if (convRateStr) {
                const num = parseFloat(convRateStr.replace(/[^0-9.]/g, ""));
                if (!isNaN(num)) conventionalRate = new Prisma.Decimal(num);
              }

              const customFieldsData: Record<string, unknown> = {};
              if (recordId) customFieldsData.zcrmRecordId = recordId;
              if (taskPersonId) customFieldsData.zcrmTaskPersonId = taskPersonId;
              if (taskPersonStr) customFieldsData.taskPersonName = taskPersonStr;
              if (assignedPersonId) customFieldsData.zcrmAssignedPersonId = assignedPersonId;
              if (assignedPersonStr) customFieldsData.assignedPersonName = assignedPersonStr;
              if (avgTimeSpent) customFieldsData.avgTimeSpent = avgTimeSpent;

              if (existingId && duplicateStrategy === "update") {
                // UPDATE existing lead
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
                    status: statusText,
                    closedAt,
                    convertedAt,
                    leadTypeId: leadTypeId || undefined,
                    productOrServiceId: productOrServiceId || undefined,
                    salesExecutiveId: salesExecutiveId || undefined,
                    leadPersonId: leadPersonId || undefined,
                    notes: notes || undefined,
                    amount: amount || undefined,
                    expectedValue: amount || undefined,
                    conventionalRate: conventionalRate || undefined,
                    nextActionDate: nextActionDate || undefined,
                    lastContactedAt: lastContactedAt || undefined,
                    updatedAt,
                    updatedById: ctx.userId,
                    customFields: Object.keys(customFieldsData).length
                      ? (customFieldsData as Prisma.InputJsonObject)
                      : undefined,
                  },
                });
                updatedCount++;
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

                leadMap.set(finalLeadNumber.toLowerCase(), createdLead.id);
                leadMap.set(finalLeadCode.toLowerCase(), createdLead.id);
                importedCount++;
              }
            } catch (rowErr) {
              errors.push({
                row: rowIdx,
                leadNumber: leadNumberRaw || "—",
                customerName: customerName || "—",
                reason: rowErr instanceof Error ? rowErr.message : "Unknown error",
              });
            }
          }
        },
        TX
      );
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
            total: rawRows.length,
            imported: importedCount,
            updated: updatedCount,
            skipped: skippedCount,
          }),
        },
      });
    }

    return NextResponse.json({
      success: true,
      total: rawRows.length,
      imported: importedCount,
      updated: updatedCount,
      skipped: skippedCount,
      errors,
    });
  });
}
