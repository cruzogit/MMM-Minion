import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readJson, withAuthRoute } from "@/lib/api";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";
import { nextCustomerCode } from "@/lib/customers/numbering";
import { nextDealSeq, nextLeadSeq, leadCodeFor, dealNumberFor, TX } from "@/lib/leads/service";
import { normalizePhone } from "@/lib/leads/format";
import { getField, looselySame, normalizeCode, normalizeStr, parseAmount, parseImportDate } from "@/lib/import/sheet";
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

// POST /api/deals/import
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    if (!hasPermission(ctx.permissions, "deals", "create")) {
      throw new ServiceError(403, "You do not have permission to import deals.");
    }
    const { rows: rawRows, duplicateStrategy, rowOffset } = await readJson(request, importBody);
    // Changing the deals that exist is editing them, not creating
    if (duplicateStrategy === "update" && !hasPermission(ctx.permissions, "deals", "edit")) {
      throw new ServiceError(403, "You do not have permission to edit deals.");
    }
    const started = Date.now();

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

    // Memory caches for options. createdOptionKeys: the options the current row added, removed again if the row fails
    const createdOptionKeys: string[] = [];
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

      const existing = optionCache.get(cacheKey);
      if (existing) return existing.id;

      // A partial match counts when it is the same words ("Instagram" for "Instagram Ads"), never part of a word
      for (const [key, opt] of optionCache.entries()) {
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

      optionCache.set(cacheKey, { id: newOption.id, label: newOption.label, parentId: newOption.parentId });
      createdOptionKeys.push(cacheKey);
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

      // 2. Check by phone number (a short number is not one to match a customer on)
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

    let processed = 0;
    for (let i = 0; i < rawRows.length; i++) {
      if (Date.now() - started > IMPORT_BUDGET_MS) break;
      processed = i + 1;
      const rowIdx = rowOffset + i + 2; // the line in the file (line 1 holds the headings)
      const r = rawRows[i];

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

      // A deal number that is already a deal is skipped before any database work
      const dealNumberCandidate = dealsIdRaw ? dealsIdRaw.trim() : "";
      const matchKey = dealNumberCandidate
        ? dealMap.get(dealNumberCandidate.toLowerCase()) || dealMap.get(normalizeCode(dealNumberCandidate))
        : null;
      if (matchKey && duplicateStrategy === "skip") {
        skippedCount++;
        continue;
      }
      const updating = !!matchKey && duplicateStrategy === "update";

      // One transaction per row: a row that fails leaves the others alone. The caches change only when the row was saved.
      const afterCommit: (() => void)[] = [];
      createdOptionKeys.length = 0;
      try {
        const outcome = await prisma.$transaction(async tx => {
          // Resolve dates
          const dealCreatedAt =
            parseImportDate(createdTimeStr) || parseImportDate(leadCreatedTimeStr) || new Date();
          const dealUpdatedAt = parseImportDate(modifiedTimeStr) || dealCreatedAt;
          const closingDate = parseImportDate(closingDateStr);
          const nextActionDate = parseImportDate(nextFollowupStr);
          const lastContactedAt = parseImportDate(lastActivityStr) || dealUpdatedAt;

          // Resolve numeric amount (a new deal without one is worth 0; an update without one keeps the amount it has)
          const parsedAmount = parseAmount(amountStr || finalQuoteAmountStr);
          const amountGiven = parsedAmount !== null && parsedAmount >= 0;
          const amountDecimal = new Prisma.Decimal(amountGiven ? parsedAmount : 0);

          // Probability
          let probability = 50;
          let probabilityGiven = false;
          if (probabilityStr) {
            const prob = parseInt(probabilityStr.replace(/\D/g, ""), 10);
            if (!isNaN(prob)) {
              probability = Math.min(100, Math.max(0, prob));
              probabilityGiven = true;
            }
          }

          // Normalize phone
          const phone = normalizePhone(phoneRaw) || phoneRaw.replace(/[^\d+]/g, "").trim() || "";

          // Resolve customer
          const effectiveCustomerName = customerName || contactPersonName || dealName || "Imported Deal Customer";
          // An update leaves the customer link alone, so it must not create a customer either
          const customerId = updating ? "" : await resolveCustomer(tx, effectiveCustomerName, phone, email, custId);

          // Resolve options
          const mainCategoryId = await resolveOption(tx, "MAIN_CATEGORY", categoryStr);
          const subcategoryId = subCategoryStr
            ? await resolveOption(tx, "SUBCATEGORY", subCategoryStr, mainCategoryId)
            : null;
          const dealStatusId = await resolveOption(tx, "DEAL_STATUS", stageStr || (updating ? "" : "Qualification"));
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
                ...(dealName ? { title: dealName } : {}),
                ...(amountGiven ? { value: amountDecimal } : {}),
                ...(probabilityGiven ? { probability } : {}),
                ...(stageStr ? { stage: stageStr } : {}),
                ...(stageStr || reasonForLoss ? { status: statusText } : {}),
                expectedCloseDate: closingDate || undefined,
                dealStatusId: dealStatusId || undefined,
                salesExecutiveId: salesExecutiveId || undefined,
                wonAt: wonAt || undefined,
                lostReason: lostReasonText || undefined,
                updatedAt: dealUpdatedAt,
              },
            });

            // The custom fields the lead already has stay; the file adds to them
            const leadBefore = await tx.lead.findUnique({ where: { id: matchKey.leadId }, select: { customFields: true } });
            const oldCustom =
              leadBefore?.customFields && typeof leadBefore.customFields === "object" && !Array.isArray(leadBefore.customFields)
                ? leadBefore.customFields
                : {};
            await tx.lead.update({
              where: { id: matchKey.leadId },
              data: {
                customerName: customerName || contactPersonName ? effectiveCustomerName : undefined,
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
                ...(siteVisitRequiredStr ? { siteVisitRequired } : {}),
                ...(amountGiven ? { amount: amountDecimal, expectedValue: amountDecimal } : {}),
                prelimQuoteStatus: prelimQuoteStatus || undefined,
                ...(stageStr || reasonForLoss ? { status: leadStatusTextVal, closedAt } : {}),
                ...(createdTimeStr || leadCreatedTimeStr ? { convertedAt: dealCreatedAt } : {}),
                nextActionDate: nextActionDate || undefined,
                lastContactedAt: lastContactedAt || undefined,
                updatedAt: dealUpdatedAt,
                updatedById: ctx.userId,
                customFields: Object.keys(customFieldsData).length
                  ? ({ ...oldCustom, ...customFieldsData } as Prisma.InputJsonObject)
                  : undefined,
              },
            });

            return "updated" as const;
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
              afterCommit.push(() => {
                if (createdLead.leadNumber) leadMap.set(createdLead.leadNumber.toLowerCase(), createdLead.id);
                if (createdLead.leadCode) leadMap.set(createdLead.leadCode.toLowerCase(), createdLead.id);
              });
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

            afterCommit.push(() => {
              if (createdDeal.dealNumber) {
                dealMap.set(createdDeal.dealNumber.toLowerCase().trim(), { id: createdDeal.id, leadId: createdDeal.leadId });
                dealMap.set(normalizeCode(createdDeal.dealNumber), { id: createdDeal.id, leadId: createdDeal.leadId });
              }
            });

            return "created" as const;
          }
        }, TX);
        afterCommit.forEach(apply => apply());
        if (outcome === "created") importedCount++;
        else updatedCount++;
      } catch (rowErr) {
        for (const key of createdOptionKeys) optionCache.delete(key);
        console.error("deals import: row failed", rowIdx, rowErr);
        errors.push({
          row: rowIdx,
          dealNumber: dealsIdRaw || "—",
          customerName: customerName || dealName || "—",
          reason: describeRowFailure(rowErr),
        });
      }
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
