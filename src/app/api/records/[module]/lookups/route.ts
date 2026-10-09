import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/api";
import { hasPermission } from "@/lib/rbac/effective";
import { ServiceError } from "@/lib/users/service";
import { activeUsers, approvers, searchDeals, searchMaterialVendors, searchServiceVendors, searchTemplates } from "@/lib/records/lookups";
import { stripControl } from "@/lib/records/values";
import { searchCustomers, searchProjects } from "@/lib/quotes/lookups";
import { moduleFrom } from "../../helpers";

type Params = { params: Promise<{ module: string }> };

// GET /api/records/<module>/lookups?kind=users|approvers|deals|materialVendors|serviceVendors|customers|projects|templates&q=
// The pick-lists of the forms, read from the live CRM data (deals and projects: &customerId=). Needs create or edit on the module.
export async function GET(request: Request, { params }: Params) {
  return withAuthRoute(request, async ctx => {
    const def = await moduleFrom(params);
    if (!hasPermission(ctx.permissions, def.permission, "create") && !hasPermission(ctx.permissions, def.permission, "edit")) {
      throw new ServiceError(403, "You do not have permission to use these lists.");
    }
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const q = stripControl(url.searchParams.get("q") ?? "").slice(0, 100);
    switch (kind) {
      case "users": return NextResponse.json({ items: await activeUsers() });
      case "approvers": return NextResponse.json({ items: await approvers(def.id) });
      case "deals": {
        const cid = url.searchParams.get("customerId") ?? undefined;
        const res = await searchDeals(q, cid);
        console.log("Lookups API: deals requested", { q, cid, resCount: res.length });
        return NextResponse.json({ items: res });
      }
      case "materialVendors": return NextResponse.json({ items: await searchMaterialVendors(q) });
      case "serviceVendors": return NextResponse.json({ items: await searchServiceVendors(q) });
      case "customers": return NextResponse.json({ items: (await searchCustomers(q)).map(c => ({ id: c.id, label: c.label, sub: c.sub, tag: c.tag })) });
      case "projects": return NextResponse.json({ items: await searchProjects(q, url.searchParams.get("customerId") ?? undefined) });
      case "templates": return NextResponse.json({ items: await searchTemplates(q) });
      default: throw new ServiceError(400, "Unknown list");
    }
  });
}
