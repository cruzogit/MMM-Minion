import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { readJson, withAuthRoute } from '@/lib/api';

const KEY = 'global_sidebar_layout';

// The folders of the sidebar and the menu items inside each (the ids of the items are the ones of the navigation list)
const folder = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(80),
  items: z.array(z.string().min(1).max(64)).max(100),
});
const body = z.object({ layout: z.array(folder).max(30) }).strict();

type Folder = z.infer<typeof folder>;

// GET /api/settings/sidebar — every signed-in user reads the layout the Super Admin arranged
export async function GET(request: Request) {
  return withAuthRoute(request, async () => {
    const setting = await prisma.userSetting.findUnique({ where: { key: KEY } });
    const stored = z.array(folder).safeParse(setting?.value);
    const layout: Folder[] = stored.success ? stored.data : [];
    return NextResponse.json({ layout: layout.map(group => ({ ...group, items: group.items.filter(item => item !== 'CUSTOMERS') })) });
  });
}

// POST /api/settings/sidebar — only a Super Admin edits the layout everybody sees
export async function POST(request: Request) {
  return withAuthRoute(request, async ctx => {
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Only Super Admins can edit the global sidebar layout' }, { status: 403 });
    }
    const { layout } = await readJson(request, body);
    await prisma.userSetting.upsert({
      where: { key: KEY },
      update: { value: layout },
      create: { key: KEY, value: layout },
    });
    return NextResponse.json({ success: true });
  });
}
