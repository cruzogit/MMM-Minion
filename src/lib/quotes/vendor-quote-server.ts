// Upload Vendor Quote, the part that talks to the database: which rows are items of the Items module already (Existing) and which are not (New), and
// the changes the person confirmed for them. The browser decides nothing here: the names are compared again and every change is checked again.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { AuthContext } from "@/lib/auth";
import { ServiceError } from "@/lib/users/service";
import { stripControl } from "@/lib/records/values";
import { needQuoteWriter, needQuotes } from "./access";
import { loadItemExtras, toItem } from "./catalog";
import { PURCHASE_ACCOUNTS } from "./item-constants";
import { loadSettings } from "./settings";
import { defaultTaxId } from "./taxes";
import type { ItemDto } from "./types";
import {
  VENDOR_MAX_DESCRIPTION, VENDOR_MAX_NAME, VENDOR_MAX_RATE, normName, round2,
  type VendorAction, type VendorApplyResult, type VendorApplyRow, type VendorMatch,
} from "./vendor-quote";

export const VENDOR_MAX_ROWS = 200;
const TX = { maxWait: 10_000, timeout: 20_000 };

type Named = { id: string; name: string; isActive: boolean; createdAt: Date };

// The items by their compared name; of several with one name the active ones first, then the oldest
function byName(items: Named[]): Map<string, Named[]> {
  const map = new Map<string, Named[]>();
  for (const it of items) {
    const key = normName(it.name);
    map.set(key, [...(map.get(key) ?? []), it]);
  }
  for (const list of map.values()) list.sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.createdAt.getTime() - b.createdAt.getTime());
  return map;
}

const loadNames = (db: Pick<typeof prisma, "catalogItem">): Promise<Named[]> => db.catalogItem.findMany({ where: { deletedAt: null }, select: { id: true, name: true, isActive: true, createdAt: true } });

/** Exact matches only: the same name after trimming, one space between words and no difference of capital letters. Nothing "similar" counts. */
export async function matchVendorItems(ctx: AuthContext, names: string[]): Promise<Record<string, VendorMatch>> {
  needQuoteWriter(ctx);
  if (names.length > VENDOR_MAX_ROWS) throw new ServiceError(400, `Send ${VENDOR_MAX_ROWS} names at a time at most.`);
  const wanted = Array.from(new Set(names.map(normName).filter(Boolean)));
  if (!wanted.length) return {};
  const index = byName(await loadNames(prisma));
  const hits = wanted.flatMap(k => (index.get(k) ? [{ key: k, list: index.get(k)! }] : []));
  if (!hits.length) return {};
  const ids = hits.map(h => h.list[0].id);
  const [rows, extras] = await Promise.all([prisma.catalogItem.findMany({ where: { id: { in: ids } } }), loadItemExtras(ids)]);
  const row = new Map(rows.map(r => [r.id, r]));
  const out: Record<string, VendorMatch> = {};
  for (const h of hits) {
    const r = row.get(h.list[0].id);
    if (!r) continue;
    out[h.key] = { item: toItem(r, extras), costPrice: r.purchaseInfo && r.costPrice !== null ? r.costPrice.toNumber() : null, duplicates: h.list.length };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Saving what the person confirmed
// ---------------------------------------------------------------------------
const ACTIONS: VendorAction[] = ["update", "keep", "add", "quote-only"];

function checkRow(r: VendorApplyRow, at: number): VendorApplyRow {
  const bad = (m: string): never => { throw new ServiceError(400, `Row ${at + 1}: ${m}`); };
  if (!ACTIONS.includes(r.action)) bad("choose what to do with the item");
  const name = stripControl(String(r.name ?? "")).replace(/\s+/g, " ").trim();
  if (!name) bad("the item name is missing");
  if (name.length > VENDOR_MAX_NAME) bad(`the item name can be ${VENDOR_MAX_NAME} characters long at most`);
  const description = stripControl(String(r.description ?? "")).replace(/[ \t]+/g, " ").trim();
  if (description.length > VENDOR_MAX_DESCRIPTION) bad(`the description can be ${VENDOR_MAX_DESCRIPTION} characters long at most`);
  const money = (v: unknown, what: string) => {
    const n = typeof v === "number" ? v : NaN;
    if (!Number.isFinite(n) || n < 0 || n > VENDOR_MAX_RATE) return bad(`${what} must be an amount from 0 to 99,999,999.99`);
    return round2(n);
  };
  const unit = stripControl(String(r.unit ?? "")).trim().slice(0, 20);
  return { key: String(r.key), action: r.action, itemId: r.itemId ? String(r.itemId) : null, name, description, rate: money(r.rate, "the rate"), sellingRate: money(r.sellingRate, "the selling rate"), unit };
}

/**
 * Applies the confirmed choices, all or nothing, in one transaction:
 *   update      the existing item gets the corrected description and the vendor's rate as its cost price (its selling price, name, tax, HSN/SAC,
 *               unit and task template stay as they are)
 *   keep        the Items module is not touched; the row still takes the item's tax, HSN/SAC, unit and task template
 *   add         a new item is created (an item with that name that appeared meanwhile is used instead, never a second one)
 *   quote-only  nothing is created; the row stays on the quote
 * A row whose Existing item is no longer there (or no longer has that name) stops the whole save with a message, so nothing is changed by mistake.
 */
export async function applyVendorItems(ctx: AuthContext, input: VendorApplyRow[]): Promise<{ results: VendorApplyResult[]; items: Record<string, ItemDto> }> {
  if (!Array.isArray(input) || input.length === 0) throw new ServiceError(400, "There is nothing to save.");
  if (input.length > VENDOR_MAX_ROWS) throw new ServiceError(400, `A quote can take ${VENDOR_MAX_ROWS} rows at a time at most.`);
  const rows = input.map(checkRow);
  needQuoteWriter(ctx);
  if (rows.some(r => r.action === "update")) needQuotes(ctx, "edit");
  if (rows.some(r => r.action === "add")) needQuotes(ctx, "create");
  const settings = rows.some(r => r.action === "add") ? await loadSettings() : null;
  const tax = settings ? defaultTaxId(settings.taxes) : "";

  const results: VendorApplyResult[] = [];
  const touched = new Set<string>();

  await prisma.$transaction(async tx => {
    // one save at a time: two people (or a double click) never create the same item twice
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"CatalogItem:vendor-quote"}))`;
    const index = byName(await loadNames(tx));
    const live = new Map<string, Named>();
    for (const list of index.values()) for (const it of list) live.set(it.id, it);
    const made = new Map<string, string>(); // items this save created, by compared name

    for (const r of rows) {
      const done = (status: VendorApplyResult["status"], itemId: string | null, message = "") => {
        results.push({ key: r.key, action: r.action, itemId, status, message });
        if (itemId) touched.add(itemId);
      };
      const key = normName(r.name);

      if (r.action === "quote-only") { done("quote-only", null); continue; }

      if (r.action === "update" || r.action === "keep") {
        const target = r.itemId ? live.get(r.itemId) : undefined;
        if (!target || normName(target.name) !== key) {
          throw new ServiceError(409, `"${r.name}" is no longer an item of the Items module with this name. Nothing was saved: check the rows and save again.`);
        }
        if (r.action === "keep") { done("kept", target.id); continue; }
        const current = await tx.catalogItem.findUniqueOrThrow({ where: { id: target.id } });
        const patch: Prisma.CatalogItemUpdateInput = {};
        const changes: string[] = [];
        if (r.description && r.description !== (current.description ?? "")) { patch.description = r.description; changes.push("description"); }
        const cost = current.costPrice === null ? null : current.costPrice.toNumber();
        if (!current.purchaseInfo || cost !== r.rate) {
          patch.purchaseInfo = true;
          patch.costPrice = r.rate;
          if (!current.purchaseAccount) patch.purchaseAccount = PURCHASE_ACCOUNTS[0];
          changes.push("cost price");
        }
        if (changes.length) await tx.catalogItem.update({ where: { id: target.id }, data: patch });
        done(changes.length ? "updated" : "unchanged", target.id, changes.join(", "));
        continue;
      }

      // add
      const existingId = made.get(key) ?? index.get(key)?.[0]?.id ?? null;
      if (existingId) { done("reused", existingId, "An item with this name is in the Items module already; it was used."); continue; }
      const created = await tx.catalogItem.create({
        data: {
          name: r.name, description: r.description || null, unit: r.unit || "nos", rate: r.sellingRate, kind: "Goods", isActive: true, taxPreference: "taxable",
          taxId: tax || null, interTaxId: tax || null, identifiers: [] as unknown as Prisma.InputJsonValue,
          purchaseInfo: true, costPrice: r.rate, purchaseAccount: PURCHASE_ACCOUNTS[0], createdById: ctx.userId,
        },
        select: { id: true },
      });
      made.set(key, created.id);
      done("created", created.id);
    }
  }, TX);

  const ids = Array.from(touched);
  const [rowsOut, extras] = await Promise.all([ids.length ? prisma.catalogItem.findMany({ where: { id: { in: ids } } }) : Promise.resolve([]), loadItemExtras(ids)]);
  return { results, items: Object.fromEntries(rowsOut.map(r => [r.id, toItem(r, extras)])) };
}
