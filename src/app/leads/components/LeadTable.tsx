'use client';

import type { ColumnFilterKey, LeadColumnId, LeadSortKey } from '@/lib/leads/constants';
import type { LeadRow } from '@/lib/leads/queries';
import HeaderCell, { type FilterGroup } from './HeaderCell';
import LeadActions, { type LeadActionHandlers } from './LeadActions';
import { CategoryCell, CustomerDetailsCell, FollowUpCell, LeadIdCell, LeadStatusCell, LocationCell, RequirementsCell, SourceCell, StaffAssignmentCell, StatusCell, type InlineContext } from './LeadCells';

type Abilities = { create: boolean; edit: boolean; delete: boolean; convert: boolean };

type Column = { id: LeadColumnId | 'actions'; label: string; sort?: LeadSortKey; filter?: string; width: string }; // filter: its key in filterGroups when it has no sort key
const COLUMN_DEFS: Record<LeadColumnId, Column> = {
  lead: { id: 'lead', label: 'Lead ID & Date', sort: 'lead', width: 'w-[150px]' },
  customer: { id: 'customer', label: 'Customer details', sort: 'customer', width: 'w-[190px]' },
  requirement: { id: 'requirement', label: 'Requirements', sort: 'requirement', width: 'w-[270px]' },
  assigned: { id: 'assigned', label: 'Staff Assignment', sort: 'assigned', width: 'w-[130px]' },
  status: { id: 'status', label: 'Lead Status', sort: 'status', width: 'w-[215px]' },
  followup: { id: 'followup', label: 'Follow-up', width: 'w-[135px]' },
  state: { id: 'state', label: 'Status', filter: 'state', width: 'w-[140px]' },
  source: { id: 'source', label: 'Mode of Customer', sort: 'source', width: 'w-[110px]' },
  category: { id: 'category', label: 'Categories', sort: 'category', width: 'w-[200px]' },
  location: { id: 'location', label: 'Location', sort: 'location', width: 'w-[210px]' },
};
const ACTIONS_COLUMN: Column = { id: 'actions', label: 'Actions', width: 'w-[110px]' };

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500 mb-1">{title}</div>{children}</div>;
}

export default function LeadTable({ rows, sort, dir, abilities, loading, columnOrder, filterGroups, onSort, onFilter, onReset, onFollowUp, onViewFollowUps, inline, handlersFor }: {
  rows: LeadRow[];
  sort?: LeadSortKey;
  dir: 'asc' | 'desc';
  abilities: Abilities;
  loading: boolean;
  columnOrder: LeadColumnId[];
  filterGroups: Record<string, FilterGroup<ColumnFilterKey>[]>; // by column: its sort key, or "state" for the Status column
  onSort: (k: LeadSortKey, d: 'asc' | 'desc') => void;
  onFilter: (next: Partial<Record<ColumnFilterKey, string[]>>) => void;
  onReset: () => void;
  onFollowUp: (row: LeadRow) => void;
  onViewFollowUps: (row: LeadRow) => void;
  inline: InlineContext; // inline editing of Amount, Lead Status, Location and Exact Location
  handlersFor: (row: LeadRow) => LeadActionHandlers;
}) {
  const activeSort = sort ?? 'lead';
  // A closed lead cannot be converted until it is reopened
  const convertBlocked = (row: LeadRow) => (row.isClosed ? 'Reopen this lead before converting it to a deal' : null);
  const columns: Column[] = [...columnOrder.map(id => COLUMN_DEFS[id]), ACTIONS_COLUMN];

  const anyFilter = Object.values(filterGroups).some(gs => gs.some(g => g.selected.length));
  const cellFor = (id: LeadColumnId, row: LeadRow) => {
    switch (id) {
      case 'lead': return <LeadIdCell row={row} />;
      case 'customer': return <CustomerDetailsCell row={row} />;
      case 'requirement': return <RequirementsCell row={row} canEdit={abilities.edit} inline={inline} />;
      case 'assigned': return <StaffAssignmentCell row={row} />;
      case 'status': return <LeadStatusCell row={row} canEdit={abilities.edit} inline={inline} />;
      case 'followup': return <FollowUpCell row={row} canEdit={abilities.edit} onUpload={() => onFollowUp(row)} onView={() => onViewFollowUps(row)} />;
      case 'state': return <StatusCell rate={row.conventionalRate} status={row.status} />;
      case 'source': return <SourceCell row={row} />;
      case 'category': return <CategoryCell row={row} />;
      case 'location': return <LocationCell row={row} canEdit={abilities.edit} inline={inline} />;
    }
  };

  if (rows.length === 0 && !anyFilter) {
    return (
      <div className="py-20 text-center text-gray-500 border border-dashed border-gray-300 rounded-lg">
        <div className="text-[16px] font-semibold text-gray-700">No leads found</div>
        <div className="text-[13px] mt-1">Try a different search or clear the filters{abilities.create ? ', or add a new lead with the + button' : ''}.</div>
      </div>
    );
  }

  return (
    <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="min-w-[1700px] w-full border-collapse">
          <thead className="bg-[#f3f4f6]">
            <tr>
              {columns.map(c => (
                <HeaderCell key={c.label} col={c} active={!!c.sort && c.sort === activeSort} dir={dir} groups={filterGroups[c.filter ?? c.sort ?? ''] ?? []} onSort={onSort} onFilter={onFilter} onReset={onReset} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} className="py-16 text-center text-gray-500"><div className="text-[16px] font-semibold text-gray-700">No leads match these filters</div><div className="text-[13px] mt-1">Open a column filter to change it, or use the reset button in Actions.</div></td></tr>
            )}
            {rows.map(row => (
              <tr key={row.id} className="border-b border-gray-200 align-middle hover:bg-[#fafafa]">
                {columns.map(c => (
                  c.id === 'actions'
                    ? <td key={c.id} className="px-3 py-2.5 align-middle sticky right-0 z-10 bg-white shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.15)]"><LeadActions canEdit={abilities.edit} canCreate={abilities.create} canDelete={abilities.delete} canConvert={abilities.convert} convertBlocked={convertBlocked(row)} canClose={abilities.edit && !row.isClosed} canReopen={abilities.edit && row.isClosed} handlers={handlersFor(row)} /></td>
                    : <td key={c.id} className="px-3 py-2.5 align-middle">{cellFor(c.id, row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tablet / phone cards */}
      <div className="lg:hidden space-y-4">
        {rows.map(row => (
          <article key={row.id} className="border border-gray-200 rounded-lg p-4 space-y-4 bg-white shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <LeadIdCell row={row} />
              <LeadActions canEdit={abilities.edit} canCreate={abilities.create} canDelete={abilities.delete} canConvert={abilities.convert} convertBlocked={convertBlocked(row)} canClose={abilities.edit && !row.isClosed} canReopen={abilities.edit && row.isClosed} handlers={handlersFor(row)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CardSection title="Customer details"><CustomerDetailsCell row={row} /></CardSection>
              <CardSection title="Staff Assignment"><StaffAssignmentCell row={row} /></CardSection>
              <CardSection title="Requirements"><RequirementsCell row={row} canEdit={abilities.edit} inline={inline} /></CardSection>
              <CardSection title="Lead Status"><LeadStatusCell row={row} canEdit={abilities.edit} inline={inline} /></CardSection>
              <CardSection title="Categories"><CategoryCell row={row} /></CardSection>
              <CardSection title="Location"><LocationCell row={row} canEdit={abilities.edit} inline={inline} /></CardSection>
              <CardSection title="Mode of Customer"><SourceCell row={row} /></CardSection>
              <div className="flex gap-6"><CardSection title="Follow-up"><FollowUpCell row={row} canEdit={abilities.edit} onUpload={() => onFollowUp(row)} onView={() => onViewFollowUps(row)} /></CardSection><CardSection title="Status"><StatusCell rate={row.conventionalRate} status={row.status} /></CardSection></div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
