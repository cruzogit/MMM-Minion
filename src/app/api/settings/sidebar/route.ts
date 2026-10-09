import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuthRoute } from '@/lib/api';
import { hasPermission } from '@/lib/rbac/effective';

export async function GET(request: Request) {
  return withAuthRoute(request, async (ctx) => {
    const setting = await prisma.userSetting.findUnique({
      where: { key: 'global_sidebar_layout' },
    });
    let layout = (setting?.value as any[]) || [];
    if (layout.length > 0) {
      layout = layout.map(group => ({ ...group, items: group.items.filter((item: string) => item !== 'CUSTOMERS') }));
    }
    return NextResponse.json({ layout });
  });
}

export async function POST(request: Request) {
  return withAuthRoute(request, async (ctx) => {
    // Only super admins can edit the global layout
    const isSuperAdmin = !!ctx.isSuperAdmin;
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Only Super Admins can edit the global sidebar layout' }, { status: 403 });
    }

    const { layout } = await request.json();
    
    await prisma.userSetting.upsert({
      where: { key: 'global_sidebar_layout' },
      update: { value: layout },
      create: { key: 'global_sidebar_layout', value: layout },
    });

    return NextResponse.json({ success: true });
  });
}
