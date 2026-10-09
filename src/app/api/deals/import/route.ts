import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/db";
import { withAuthRoute, jsonError } from "@/lib/api";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";
import { nextCustomerCode } from "@/lib/customers/numbering";
import { nextDealSeq, nextLeadSeq, leadCodeFor, dealNumberFor, TX } from "@/lib/leads/service";
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

function normalizeCode(s: unknown): string {
  if (!s) return "";
  return String(s).toLowerCase().replace(/[\s\-_]/g, "");
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
    if (val.getFullYear() < 2000) return null; // Ignore 1899 Excel epoch
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

// POST /api/deals/import
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    if (!hasPermission(ctx.permissions, "deals", "create")) {
      throw new ServiceError(403, "You do not have permission to import deals.");
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
    const [employees, allOptions, existingDeals, existingLeads] = await Promise.all([
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
      prisma.deal.findMany({
        where: { deletedAt: null },
        select: { id: true, dealNumber: true, leadId: true },
      }),
      prisma.lead.findMany({
        where: { deletedAt: null },
        select: { id: true, leadNumber: true, leadCode: true },
      }),
    ]);

    // Memory caches for options
    const optionCache = new Map<string, { id: string; label: string; parentId: string | null }>();
    for (const opt of allOptions) {
      optionCache.set(`${opt.type}::${normalizeStr(opt.label)}`, {
        id: opt.id,
        label: opt.label,
        parentId: opt.parentId,
      });
    }

    // Deals map: normalized deal number / exact deal number -> dealId & leadId
    const dealMap = new Map<string, { id: string; leadId: string }>();
    for (const d of existingDeals) {
      if (d.dealNumber) {
        dealMap.set(d.dealNumber.toLowerCase().trim(), { id: d.id, leadId: d.leadId });
        dealMap.set(normalizeCode(d.dealNumber), { id: d.id, leadId: d.leadId });
      }
    }

    // Leads map: leadNumber / leadCode -> leadId
    const leadMap = new Map<string, string>();
    for (const l of existingLeads) {
      if (l.leadNumber) leadMap.set(l.leadNumber.toLowerCase().trim(), l.id);
      if (l.leadCode) leadMap.set(l.leadCode.toLowerCase().trim(), l.id);
    }

    // Helper: Match employee
    const matchEmployee = (str: string): string | null => {
      if (!str) return null;
      // 1. Try matching trailing 2-4 digit code (e.g. "Kiruba 015" -> "015", "Mukesh 007" -> "007")
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

      const existing = optionCache.get(cacheKey);
      if (existing) return existing.id;

      // Check for partial/fuzzy match among existing options of that type
      for (const [key, opt] of optionCache.entries()) {
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

      optionCache.set(cacheKey, { id: newOption.id, label: newOption.label, parentId: newOption.parentId });
      return newOption.id;
    };

    // Helper: Find or create customer
    const resolveCustomer = async (
      tx: Prisma.TransactionClient,
      customerName: string,
      contactNumber: string,
      email?: string,
      custId?: string
    ): Promise<string> => {
      const name = customerName.trim() || "Imported Deal Customer";
      const phoneDigits = contactNumber ? contactNumber.replace(/\D/g, "") : "";

      // 1. Check by Cust ID / Customer Code if provided
      if (custId && custId.trim()) {
        const byCode = await tx.customer.findFirst({
          where: { customerCode: custId.trim() },
          select: { id: true },
        });
        if (byCode) return byCode.id;
      }

      // 2. Check by phone number
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

      // 3. Check by email
      if (email && email.trim()) {
        const byEmail = await tx.customer.findFirst({
          where: { email: { equals: email.trim(), mode: "insensitive" } },
          select: { id: true },
        });
        if (byEmail) return byEmail.id;
      }

      // 4. Check by name
      const byName = await tx.customer.findFirst({
        where: { name: { equals: name, mode: "insensitive" } },
        select: { id: true },
      });
      if (byName) return byName.id;

      // 5. Create new Customer
      let code: string;
      if (custId && custId.trim()) {
        // Test if code is already taken
        const taken = await tx.customer.findFirst({ where: { customerCode: custId.trim() } });
        code = taken ? await nextCustomerCode(tx) : custId.trim();
      } else {
        code = await nextCustomerCode(tx);
      }

      const created = await tx.customer.create({
        data: {
          name,
          phone: contactNumber || null,
          email: email?.trim() || null,
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
    const errors: { row: number; dealNumber: string; customerName: string; reason: string }[] = [];

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
            const dealsIdRaw = getField(r, "Deals ID", "DealsID", "Deal ID", "DealID", "Deal Number", "DealNumber", "code");
            const dealName = getField(r, "Deal Name", "DealName", "Title", "Name");
            const amountStr = getField(r, "Amount", "Deal Value", "Value", "Final Quote Amount", "FinalQuoteAmount");
            const closingDateStr = getField(r, "Closing Date", "ClosingDate", "Expected Close Date", "Validity");
            const customerName = getField(r, "Customer Name", "CustomerName", "Customer", "Lead Name", "Name");
            const contactPersonName = getField(r, "Contact Person Name", "Contact Person", "ContactPersonName");
            const stageStr = getField(r, "Stage", "Deal Status", "DealStatus", "Status");
            const probabilityStr = getField(r, "Probability (%)", "Probability", "Prob");
            const expectedRevenueStr = getField(r, "Expected Revenue", "ExpectedRevenue");
            const leadSourceStr = getField(r, "Lead Source", "LeadSource", "Source");
            const leadNumberRaw = getField(r, "Lead Number", "LeadNumber", "Lead ID", "LeadCode");
            const phoneRaw = getField(r, "Phone", "Contact Number", "Mobile", "ContactNumber");
            const email = getField(r, "Email", "Customer Email", "E-mail");
            const requirements = getField(r, "Requirements", "Exact Requirement", "Requirement");
            const categoryStr = getField(r, "Category", "Main Category", "MainCategory");
            const subCategoryStr = getField(r, "Sub Category", "SubCategory", "Subcategory");
            const city = getField(r, "City", "Location", "Site Location");
            const assignedPersonStr = getField(r, "Assigned Person", "AssignedPerson", "Lead Person");
            const assignedPersonId = getField(r, "Assigned Person.id", "AssignedPerson.id");
            const taskPersonStr = getField(r, "Task Person", "TaskPerson", "Sales Executive", "Task Assigned Person");
            const taskPersonId = getField(r, "Task Person.id", "TaskPerson.id");
            const typeOfLeadStr = getField(r, "Type of Lead", "TypeOfLead", "Priority", "Lead Priority");
            const leadTypeStr = getField(r, "Lead Type", "LeadType", "Business Type", "Product or Service");
            const reasonForLoss = getField(r, "Reason For Loss", "Reason For Deal Loss", "Loss Reason");
            const description = getField(r, "Description", "Notes", "Remarks");
            const createdTimeStr = getField(r, "Created Time", "CreatedTime", "Deal Created Time");
            const modifiedTimeStr = getField(r, "Modified Time", "ModifiedTime", "Updated Time");
            const leadCreatedTimeStr = getField(r, "Lead-Created-Time", "Lead Created Time", "Lead Created Date", "Date");
            const nextFollowupStr = getField(r, "Next Followup Date", "NextFollowupDate", "Follow Up Next Date");
            const locationLink = getField(r, "Location Link", "LocationLink", "Map Link");
            const siteVisitRequiredStr = getField(r, "Site Visit Required", "SiteVisitRequired");
            const siteVisitDateStr = getField(r, "Site Visit Date", "SiteVisitDate");
            const prelimQuoteStatus = getField(r, "Preliminary Quote Status", "PrelimQuoteStatus");
            const finalQuoteAmountStr = getField(r, "Final Quote Amount", "FinalQuoteAmount");
            const negotiationAmountStr = getField(r, "Negotiation Amount", "NegotiationAmount");
            const budgetRange = getField(r, "Budget Range", "Budget");
            const custId = getField(r, "Cust ID", "CustID", "Customer Code", "Customer ID");
            const booksEstimateId = getField(r, "Books Estimate ID", "Books_Estimate_ID", "BooksEstimateID");
            const projectId = getField(r, "Project ID", "ProjectID");
            const projectLink = getField(r, "Project Link", "ProjectLink");
            const selectedQuote = getField(r, "Selected Quote", "Selected Quote.id", "SelectedQuote");
            const dealOwnerStr = getField(r, "Deal Owner", "DealOwner");
            const dealOwnerId = getField(r, "Deal Owner.id", "DealOwner.id");
            const currency = getField(r, "Currency");
            const exchangeRate = getField(r, "Exchange Rate", "ExchangeRate");
            const lastActivityStr = getField(r, "Last Activity Time", "LastActivityTime");

            // Skip empty rows
            if (!dealsIdRaw && !dealName && !customerName && !phoneRaw && !requirements) {
              continue;
            }

            try {
              // Deal identification
              const dealNumberCandidate = dealsIdRaw ? dealsIdRaw.trim() : "";
              const matchKey = dealNumberCandidate
                ? dealMap.get(dealNumberCandidate.toLowerCase()) || dealMap.get(normalizeCode(dealNumberCandidate))
                : null;

              if (matchKey) {
                if (duplicateStrategy === "skip") {
                  skippedCount++;
                  continue;
                }
              }

              // Resolve dates
              const dealCreatedAt =
                parseImportDate(createdTimeStr) || parseImportDate(leadCreatedTimeStr) || new Date();
              const dealUpdatedAt = parseImportDate(modifiedTimeStr) || dealCreatedAt;
              const closingDate = parseImportDate(closingDateStr);
              const nextActionDate = parseImportDate(nextFollowupStr);
              const lastContactedAt = parseImportDate(lastActivityStr) || dealUpdatedAt;

              // Resolve numeric amount
              let amountValue = 0;
              const cleanAmt = (amountStr || finalQuoteAmountStr).replace(/[^0-9.]/g, "");
              if (cleanAmt) {
                const parsed = parseFloat(cleanAmt);
                if (!isNaN(parsed)) amountValue = parsed;
              }
              const amountDecimal = new Prisma.Decimal(amountValue);

              // Probability
              let probability = 50;
              if (probabilityStr) {
                const prob = parseInt(probabilityStr.replace(/\D/g, ""), 10);
                if (!isNaN(prob)) probability = Math.min(100, Math.max(0, prob));
              }

              // Normalize phone
              const phone = normalizePhone(phoneRaw) || phoneRaw.replace(/[^\d+]/g, "").trim() || "";

              // Resolve customer
              const effectiveCustomerName = customerName || contactPersonName || dealName || "Imported Deal Customer";
              const customerId = await resolveCustomer(tx, effectiveCustomerName, phone, email, custId);

              // Resolve options
              const mainCategoryId = await resolveOption(tx, "MAIN_CATEGORY", categoryStr);
              const subcategoryId = subCategoryStr
                ? await resolveOption(tx, "SUBCATEGORY", subCategoryStr, mainCategoryId)
                : null;
              const dealStatusId = await resolveOption(tx, "DEAL_STATUS", stageStr || "Qualification");
              const sourceId = await resolveOption(tx, "SOURCE", leadSourceStr);
              const leadTypeId = await resolveOption(tx, "LEAD_TYPE", typeOfLeadStr);

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
              const salesExecutiveId = matchEmployee(taskPersonStr) || matchEmployee(dealOwnerStr) || null;
              const leadPersonId = matchEmployee(assignedPersonStr) || salesExecutiveId || ctx.employeeId || null;

              // Deal Stage / Status / Won / Lost logic
              const normStage = normalizeStr(stageStr);
              const isWon = normStage.includes("won") || normStage.includes("completed");
              const isLost = normStage.includes("lost") || normStage.includes("rejected") || Boolean(reasonForLoss);
              const statusText = isWon ? "Won" : isLost ? "Lost" : "Open";
              const leadStatusTextVal = isWon ? "Won" : isLost ? "Closed" : "New";
              const wonAt = isWon ? dealUpdatedAt : null;
              const lostReasonText = isLost ? reasonForLoss || "Closed Lost" : null;
              const closedAt = isLost ? dealUpdatedAt : null;

              // Site visit required
              const siteVisitRequired = siteVisitRequiredStr
                ? siteVisitRequiredStr.toLowerCase() === "true" || siteVisitRequiredStr.toLowerCase() === "yes"
                : false;

              // Custom fields payload to save on Lead record
              const customFieldsData: Record<string, unknown> = {};
              if (recordId) customFieldsData.zcrmRecordId = recordId;
              if (dealOwnerId) customFieldsData.zcrmDealOwnerId = dealOwnerId;
              if (dealOwnerStr) customFieldsData.dealOwner = dealOwnerStr;
              if (assignedPersonId) customFieldsData.zcrmAssignedPersonId = assignedPersonId;
              if (assignedPersonStr) customFieldsData.assignedPersonName = assignedPersonStr;
              if (taskPersonId) customFieldsData.zcrmTaskPersonId = taskPersonId;
              if (taskPersonStr) customFieldsData.taskPersonName = taskPersonStr;
              if (expectedRevenueStr) customFieldsData.expectedRevenue = expectedRevenueStr;
              if (currency) customFieldsData.currency = currency;
              if (exchangeRate) customFieldsData.exchangeRate = exchangeRate;
              if (contactPersonName) customFieldsData.contactPersonName = contactPersonName;
              if (budgetRange) customFieldsData.budgetRange = budgetRange;
              if (negotiationAmountStr) customFieldsData.negotiationAmount = negotiationAmountStr;
              if (finalQuoteAmountStr) customFieldsData.finalQuoteAmount = finalQuoteAmountStr;
              if (booksEstimateId) customFieldsData.booksEstimateId = booksEstimateId;
              if (projectId) customFieldsData.zohoProjectId = projectId;
              if (projectLink) customFieldsData.projectLink = projectLink;
              if (selectedQuote) customFieldsData.selectedQuote = selectedQuote;
              if (siteVisitDateStr) customFieldsData.siteVisitDate = siteVisitDateStr;
              if (custId) customFieldsData.custId = custId;

              if (matchKey && duplicateStrategy === "update") {
                // UPDATE existing Deal & its Lead
                await tx.deal.update({
                  where: { id: matchKey.id },
                  data: {
                    title: dealName || effectiveCustomerName,
                    value: amountDecimal,
                    probability,
                    stage: stageStr || "Qualification",
                    status: statusText,
                    expectedCloseDate: closingDate || undefined,
                    dealStatusId: dealStatusId || undefined,
                    salesExecutiveId: salesExecutiveId || undefined,
                    wonAt: wonAt || undefined,
                    lostReason: lostReasonText || undefined,
                    updatedAt: dealUpdatedAt,
                  },
                });

                await tx.lead.update({
                  where: { id: matchKey.leadId },
                  data: {
                    customerName: effectiveCustomerName,
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
                    leadTypeId: leadTypeId || undefined,
                    productOrServiceId: productOrServiceId || undefined,
                    salesExecutiveId: salesExecutiveId || undefined,
                    leadPersonId: leadPersonId || undefined,
                    notes: description || undefined,
                    budgetRange: budgetRange || undefined,
                    siteVisitRequired,
                    amount: amountDecimal,
                    expectedValue: amountDecimal,
                    prelimQuoteStatus: prelimQuoteStatus || undefined,
                    status: leadStatusTextVal,
                    closedAt,
                    convertedAt: dealCreatedAt,
                    nextActionDate: nextActionDate || undefined,
                    lastContactedAt: lastContactedAt || undefined,
                    updatedAt: dealUpdatedAt,
                    updatedById: ctx.userId,
                    customFields: Object.keys(customFieldsData).length
                      ? (customFieldsData as Prisma.InputJsonObject)
                      : undefined,
                  },
                });

                updatedCount++;
              } else {
                // CREATE new Deal & Lead
                // 1. Resolve or create Lead
                let leadIdToUse: string;
                const leadNumCandidate = leadNumberRaw ? leadNumberRaw.trim().toLowerCase() : "";
                const existingLeadId = leadNumCandidate ? leadMap.get(leadNumCandidate) : null;

                if (existingLeadId) {
                  leadIdToUse = existingLeadId;
                  // Update existing lead to converted state
                  await tx.lead.update({
                    where: { id: existingLeadId },
                    data: {
                      convertedAt: dealCreatedAt,
                      closedAt,
                      status: leadStatusTextVal,
                      updatedAt: dealUpdatedAt,
                      updatedById: ctx.userId,
                    },
                  });
                } else {
                  // Create new Lead
                  const leadSeq = await nextLeadSeq(tx);
                  const generatedLeadCode = leadCodeFor(leadSeq);
                  const finalLeadNumber = leadNumberRaw.trim() || generatedLeadCode;
                  const finalLeadCode = leadNumberRaw.trim() || generatedLeadCode;

                  const createdLead = await tx.lead.create({
                    data: {
                      customerId,
                      leadSeq,
                      leadCode: finalLeadCode,
                      leadNumber: finalLeadNumber,
                      customerName: effectiveCustomerName,
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
                      leadTypeId,
                      productOrServiceId,
                      salesExecutiveId,
                      leadPersonId,
                      notes: description || null,
                      budgetRange: budgetRange || null,
                      siteVisitRequired,
                      amount: amountDecimal,
                      expectedValue: amountDecimal,
                      prelimQuoteStatus: prelimQuoteStatus || "Not Sent",
                      status: leadStatusTextVal,
                      closedAt,
                      convertedAt: dealCreatedAt, // Converted into deal
                      enquiryDate: dealCreatedAt,
                      nextActionDate,
                      lastContactedAt,
                      createdAt: dealCreatedAt,
                      updatedAt: dealUpdatedAt,
                      createdById: ctx.userId,
                      updatedById: ctx.userId,
                      customFields: Object.keys(customFieldsData).length
                        ? (customFieldsData as Prisma.InputJsonObject)
                        : Prisma.DbNull,
                    },
                    select: { id: true, leadNumber: true, leadCode: true },
                  });

                  leadIdToUse = createdLead.id;
                  if (createdLead.leadNumber) leadMap.set(createdLead.leadNumber.toLowerCase(), createdLead.id);
                  if (createdLead.leadCode) leadMap.set(createdLead.leadCode.toLowerCase(), createdLead.id);
                }

                // 2. Determine dealNumber
                let finalDealNumber: string;
                if (dealNumberCandidate) {
                  finalDealNumber = dealNumberCandidate;
                  // If collision and create_new strategy:
                  if (dealMap.has(finalDealNumber.toLowerCase()) || dealMap.has(normalizeCode(finalDealNumber))) {
                    const nextSeq = await nextDealSeq(tx);
                    finalDealNumber = `${finalDealNumber}-${nextSeq}`;
                  }
                } else {
                  const dealSeq = await nextDealSeq(tx);
                  finalDealNumber = dealNumberFor(dealSeq);
                }

                // 3. Create Deal
                const createdDeal = await tx.deal.create({
                  data: {
                    dealNumber: finalDealNumber,
                    leadId: leadIdToUse,
                    customerId,
                    title: dealName || effectiveCustomerName || `Deal ${finalDealNumber}`,
                    value: amountDecimal,
                    probability,
                    stage: stageStr || "Qualification",
                    status: statusText,
                    expectedCloseDate: closingDate || null,
                    dealStatusId,
                    salesExecutiveId,
                    wonAt,
                    lostReason: lostReasonText,
                    createdAt: dealCreatedAt,
                    updatedAt: dealUpdatedAt,
                  },
                  select: { id: true, dealNumber: true, leadId: true },
                });

                // 4. Create follow-up record if next follow-up date was specified
                if (nextActionDate) {
                  await tx.leadFollowUp.create({
                    data: {
                      leadId: leadIdToUse,
                      notes: "Scheduled follow-up from import",
                      nextAt: nextActionDate,
                      completedAt: lastContactedAt || dealCreatedAt,
                      createdAt: dealCreatedAt,
                      createdById: ctx.userId,
                    },
                  });
                }

                if (createdDeal.dealNumber) {
                  dealMap.set(createdDeal.dealNumber.toLowerCase().trim(), { id: createdDeal.id, leadId: createdDeal.leadId });
                  dealMap.set(normalizeCode(createdDeal.dealNumber), { id: createdDeal.id, leadId: createdDeal.leadId });
                }

                importedCount++;
              }
            } catch (rowErr) {
              errors.push({
                row: rowIdx,
                dealNumber: dealsIdRaw || "—",
                customerName: customerName || dealName || "—",
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
          entityType: "Deal",
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
