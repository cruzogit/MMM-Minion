import { redirect } from 'next/navigation';
import { requirePageAccess } from '@/lib/auth';
import { todayDay } from '@/lib/leads/format';
import { getLayout } from '@/lib/records/layout';
import { activeUsers } from '@/lib/records/lookups';
import { quoteAbilities } from '@/lib/quotes/access';
import { getNewDraft, listMyDrafts } from '@/lib/quotes/draft-server';
import { peekNumber } from '@/lib/quotes/numbering-server';
import { companyImageUrls } from '@/lib/quotes/settings-files';
import { loadSettings } from '@/lib/quotes/settings';
import QuoteEditor from '../QuoteEditor';

export const dynamic = 'force-dynamic';

// New Quote: the form follows the Quote layout (Edit Page Layout); numbers, taxes and rounding come from Quote Settings. Every change is saved as a draft
// (?draft=...), so a refresh or a closed tab brings the same quote back.
export default async function Page({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  const ctx = await requirePageAccess(['quotes'], 'create');
  const { draft: draftId } = await searchParams;
  const today = todayDay();
  const settings = await loadSettings();
  const [layout, users, next, images, found, mine] = await Promise.all([
    getLayout('quote'),
    activeUsers(),
    peekNumber(settings.numbering, today),
    companyImageUrls(settings.company),
    draftId ? getNewDraft(ctx, draftId) : Promise.resolve(null),
    draftId ? Promise.resolve([]) : listMyDrafts(ctx),
  ]);
  if (draftId && !found) redirect('/quotes/new'); // it was saved or discarded meanwhile (the Back button, another window)
  return (
    <QuoteEditor
      key="new" // the same screen whether or not a draft exists yet: it must not start over when the address gets ?draft= after the first save
      mode="create"
      layout={layout}
      settings={settings}
      nextNumber={next.number}
      users={users}
      me={{ id: ctx.userId, name: ctx.name ?? '' }}
      abilities={quoteAbilities(ctx)}
      today={today}
      images={images}
      serverDraft={found ? { id: found.id, rev: found.rev, quoteNumber: found.quoteNumber, updatedAt: found.updatedAt, state: found.state } : null}
      pending={mine.filter(d => d.kind === 'new').slice(0, 1)}
    />
  );
}
