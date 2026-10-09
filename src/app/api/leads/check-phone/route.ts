import { NextResponse } from "next/server";
import { withAuthRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { normalizePhone } from "@/lib/leads/format";

export async function GET(request: Request) {
  return withAuthRoute(request, async ctx => {
    const sp = new URL(request.url).searchParams;
    const phone = normalizePhone(sp.get("phone") || "");
    if (!phone) return NextResponse.json({ exists: false });

    // Loose match similar to findOrCreateCustomer
    const loose = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Customer" WHERE regexp_replace("phone", '[^0-9+]', '', 'g') = ${phone} LIMIT 1`;
    
    if (loose[0]) {
       // Check if customer has a lead or deal
       const hasLead = await prisma.lead.findFirst({ where: { customerId: loose[0].id, deletedAt: null }, select: { id: true } });
       if (hasLead) return NextResponse.json({ exists: true });
    }

    return NextResponse.json({ exists: false });
  });
}
