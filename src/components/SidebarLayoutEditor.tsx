'use client';

import { useState, useEffect, createElement } from 'react';
import { 
  X, 
  Plus, 
  Trash2, 
  GripVertical, 
  Save, 
  Folder, 
  LayoutTemplate, 
  Loader2,
  CheckCircle2,
  Home, 
  ClipboardList, 
  Handshake, 
  FileText, 
  Package, 
  Boxes, 
  Wrench, 
  Wallet, 
  HandCoins, 
  CalendarCheck, 
  LayoutGrid, 
  Users, 
  UserCog,
  type LucideIcon 
} from 'lucide-react';
import { 
  DndContext, 
  closestCorners, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
  DragOverlay,
  useDroppable 
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  verticalListSortingStrategy, 
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { allNavItems } from './Sidebar';

export type SidebarGroup = {
  id: string;
  title: string;
  items: string[];
};

const NAV_ICON_MAP: Record<string, LucideIcon> = {
  'HOME': Home,
  'LEADS': ClipboardList,
  'DEALS': Handshake,
  'QUOTES': FileText,
  'ITEMS': Package,
  'MATERIAL VENDOR': Boxes,
  'SERVICE VENDOR': Wrench,
  'PRE-PAYMENT RECORDS': Wallet,
  'PAYMENT COLLECTION RECORDS': HandCoins,
  'ATTENDANCE': CalendarCheck,
  'TASKS': CheckCircle2,
  'PROJECTS': LayoutGrid,
  'TEAM': Users,
  'USERS': UserCog,
};

function getItemIcon(label: string): LucideIcon {
  return NAV_ICON_MAP[label] || LayoutGrid;
}

interface SortableItemProps {
  id: string;
  label: string;
  currentGroupId: string;
  allGroups: SidebarGroup[];
  onRemove: () => void;
  onMove: (targetGroupId: string) => void;
}

function SortableItem({ id, label, currentGroupId, allGroups, onRemove, onMove }: SortableItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2.5 bg-gray-50 hover:bg-amber-50/40 p-2.5 rounded-lg border transition-all group ${
        isDragging ? 'border-amber-400 bg-amber-50/50' : 'border-gray-200 hover:border-amber-300'
      }`}
    >
      <div 
        {...attributes} 
        {...listeners} 
        className="cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-700 p-0.5 rounded hover:bg-gray-200/50 transition-colors"
        title="Drag to reorder or move to another folder"
      >
        <GripVertical className="w-4 h-4" />
      </div>
      {createElement(getItemIcon(label), { className: 'w-4 h-4 text-gray-500 group-hover:text-amber-600 shrink-0 transition-colors' })}
      <span className="flex-1 text-[13px] font-semibold text-gray-800 truncate">{label}</span>
      
      {/* Quick Move To Dropdown */}
      <div className="flex items-center gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
        <select
          value=""
          onChange={e => {
            if (e.target.value) {
              onMove(e.target.value);
            }
          }}
          className="text-[11px] font-medium text-gray-600 bg-white border border-gray-200 rounded px-2 py-1 hover:border-gray-300 focus:outline-none focus:border-amber-500 cursor-pointer shadow-xs transition-colors"
          title="Move to another folder"
        >
          <option value="">Move to...</option>
          {allGroups.map(g => (
            <option key={g.id} value={g.id} disabled={g.id === currentGroupId}>
              {g.title} {g.id === currentGroupId ? '(here)' : ''}
            </option>
          ))}
        </select>
        
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
          title="Remove from folder"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function DroppableFolder({
  group,
  allGroups,
  onUpdateTitle,
  onRemoveGroup,
  onRemoveItem,
  onMoveItem,
  onAddItem,
  unassigned
}: {
  group: SidebarGroup;
  allGroups: SidebarGroup[];
  onUpdateTitle: (title: string) => void;
  onRemoveGroup: () => void;
  onRemoveItem: (item: string) => void;
  onMoveItem: (item: string, targetGroupId: string) => void;
  onAddItem: (item: string) => void;
  unassigned: string[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: group.id });

  return (
    <div 
      className={`bg-white border rounded-xl p-4 shadow-sm transition-all ${
        isOver 
          ? 'border-amber-400 ring-2 ring-amber-400/40 bg-amber-50/20' 
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center gap-3 mb-3.5">
        <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
          <Folder className="w-4 h-4" />
        </div>
        <input 
          value={group.title} 
          onChange={e => onUpdateTitle(e.target.value)}
          className="bg-transparent text-[14px] font-bold text-gray-900 uppercase tracking-wide focus:outline-none focus:bg-amber-50/40 px-2 py-1 rounded border border-transparent hover:border-gray-200 focus:border-amber-400 min-w-[200px] transition-colors"
          placeholder="FOLDER TITLE"
        />
        <span className="text-[11px] font-semibold text-gray-400 bg-gray-100 px-2.5 py-0.5 rounded-full">
          {group.items.length} {group.items.length === 1 ? 'item' : 'items'}
        </span>
        <div className="flex-1" />
        <button 
          type="button"
          onClick={onRemoveGroup} 
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" 
          title="Delete Folder"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div ref={setNodeRef} className="space-y-2 min-h-[44px]">
        <SortableContext items={group.items} strategy={verticalListSortingStrategy}>
          {group.items.map(item => (
            <SortableItem 
              key={item} 
              id={item} 
              label={item}
              currentGroupId={group.id}
              allGroups={allGroups}
              onRemove={() => onRemoveItem(item)} 
              onMove={(targetGroupId) => onMoveItem(item, targetGroupId)}
            />
          ))}
        </SortableContext>

        {group.items.length === 0 && (
          <div className="py-4 px-3 border border-dashed border-gray-200 rounded-lg text-center text-[12px] text-gray-400 italic bg-gray-50/50">
            Drop items here or use the dropdown below
          </div>
        )}
      </div>

      {unassigned.length > 0 && (
        <div className="pt-3 mt-2 border-t border-gray-100 flex items-center gap-2">
          <select 
            onChange={(e) => { if (e.target.value) onAddItem(e.target.value); }}
            value=""
            className="bg-white text-[12px] font-medium text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 shadow-sm hover:border-gray-300 focus:outline-none focus:border-amber-500 cursor-pointer"
          >
            <option value="">+ Add item to folder...</option>
            {unassigned.map(item => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function findContainer(id: string, groups: SidebarGroup[]): string | null {
  const groupById = groups.find(g => g.id === id);
  if (groupById) return groupById.id;

  const groupByItem = groups.find(g => g.items.includes(id));
  if (groupByItem) return groupByItem.id;

  return null;
}

export default function SidebarLayoutEditor({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [groups, setGroups] = useState<SidebarGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unassigned, setUnassigned] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/settings/sidebar')
      .then(res => res.json())
      .then(data => {
        let layout: SidebarGroup[] = data.layout || [];
        if (!layout.length) {
          layout = [
            { id: 'g1', title: 'MY WORKSPACE', items: ['HOME', 'TASKS', 'ATTENDANCE'] },
            { id: 'g2', title: 'CRM', items: ['LEADS', 'DEALS', 'QUOTES'] },
            { id: 'g3', title: 'DELIVERY', items: ['PROJECTS'] },
            { id: 'g4', title: 'PEOPLE', items: ['TEAM', 'USERS'] }
          ];
        }
        setGroups(layout);
        
        const assigned = new Set(layout.flatMap(g => g.items));
        setUnassigned(allNavItems.filter(n => !assigned.has(n.label)).map(n => n.label));
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeItem = String(active.id);
    const overTarget = String(over.id);

    if (activeItem === overTarget) return;

    const activeContainer = findContainer(activeItem, groups);
    const overContainer = findContainer(overTarget, groups);

    if (!activeContainer || !overContainer || activeContainer === overContainer) {
      return;
    }

    // Moving between two different folders
    setGroups(prev => {
      const sourceGroup = prev.find(g => g.id === activeContainer);
      const targetGroup = prev.find(g => g.id === overContainer);
      if (!sourceGroup || !targetGroup) return prev;

      const sourceItems = sourceGroup.items.filter(i => i !== activeItem);
      const targetItems = [...targetGroup.items.filter(i => i !== activeItem)];
      
      const overIndex = targetItems.indexOf(overTarget);
      if (overIndex >= 0) {
        targetItems.splice(overIndex, 0, activeItem);
      } else {
        targetItems.push(activeItem);
      }

      return prev.map(g => {
        if (g.id === activeContainer) return { ...g, items: sourceItems };
        if (g.id === overContainer) return { ...g, items: targetItems };
        return g;
      });
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const activeItem = String(active.id);
    const overTarget = String(over.id);

    const activeContainer = findContainer(activeItem, groups);
    const overContainer = findContainer(overTarget, groups);

    if (!activeContainer || !overContainer) return;

    if (activeContainer === overContainer) {
      setGroups(prev => prev.map(g => {
        if (g.id === activeContainer) {
          const oldIndex = g.items.indexOf(activeItem);
          const newIndex = g.items.indexOf(overTarget);
          if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
            return { ...g, items: arrayMove(g.items, oldIndex, newIndex) };
          }
        }
        return g;
      }));
    }
  };

  const moveItemTo = (item: string, targetGroupId: string) => {
    setGroups(prev => prev.map(g => {
      if (g.id === targetGroupId) {
        return { ...g, items: [...g.items.filter(i => i !== item), item] };
      }
      return { ...g, items: g.items.filter(i => i !== item) };
    }));
    setUnassigned(prev => prev.filter(i => i !== item));
  };

  const addGroup = () => {
    setGroups([...groups, { id: 'g' + Date.now(), title: 'NEW FOLDER', items: [] }]);
  };

  const removeGroup = (id: string) => {
    const group = groups.find(g => g.id === id);
    if (group) setUnassigned(prev => [...prev, ...group.items]);
    setGroups(groups.filter(g => g.id !== id));
  };

  const updateGroupTitle = (id: string, title: string) => {
    setGroups(groups.map(g => g.id === id ? { ...g, title } : g));
  };

  const removeItemFromGroup = (groupId: string, item: string) => {
    setGroups(groups.map(g => g.id === groupId ? { ...g, items: g.items.filter(i => i !== item) } : g));
    setUnassigned(prev => prev.includes(item) ? prev : [...prev, item]);
  };

  const addItemToGroup = (groupId: string, item: string) => {
    setGroups(groups.map(g => g.id === groupId ? { ...g, items: [...g.items, item] } : g));
    setUnassigned(prev => prev.filter(i => i !== item));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/sidebar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layout: groups })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Failed to save sidebar layout');
        setSaving(false);
        return;
      }
    } catch {
      setError('An error occurred while saving.');
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
    onClose();
    window.location.reload();
  };

  if (loading) return null;

  return (
    <div className="fixed inset-0 z-[100] flex bg-black/60 backdrop-blur-sm items-center justify-center p-4">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-2xl h-[88vh] flex flex-col shadow-2xl overflow-hidden text-gray-900">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/60 text-amber-600 flex items-center justify-center shrink-0">
              <LayoutTemplate className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[18px] font-bold text-gray-900 leading-tight">Edit Sidebar Layout</h2>
              <p className="text-[12px] text-gray-500 mt-0.5">Drag items between folders or use the Move to menu to organize your sidebar.</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={onClose} 
            className="p-2 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Global DndContext wrapping all folders */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50/70">
            {groups.map(group => (
              <DroppableFolder 
                key={group.id}
                group={group}
                allGroups={groups}
                onUpdateTitle={title => updateGroupTitle(group.id, title)}
                onRemoveGroup={() => removeGroup(group.id)}
                onRemoveItem={item => removeItemFromGroup(group.id, item)}
                onMoveItem={(item, targetGroupId) => moveItemTo(item, targetGroupId)}
                onAddItem={item => addItemToGroup(group.id, item)}
                unassigned={unassigned}
              />
            ))}

            <button 
              type="button"
              onClick={addGroup} 
              className="w-full py-3.5 border-2 border-dashed border-gray-300 hover:border-amber-500 hover:bg-amber-50/30 rounded-xl text-gray-600 hover:text-amber-700 flex items-center justify-center gap-2 transition-all group"
            >
              <Plus className="w-5 h-5 text-gray-400 group-hover:text-amber-600 transition-colors" />
              <span className="text-[13px] font-bold tracking-wider uppercase">Add New Folder</span>
            </button>
          </div>

          {/* Floating Drag Overlay */}
          <DragOverlay>
            {activeId ? (
              <div className="flex items-center gap-2.5 bg-white p-2.5 rounded-lg border-2 border-amber-400 shadow-xl opacity-95 pointer-events-none">
                <GripVertical className="w-4 h-4 text-amber-500" />
                {(() => {
                  const Icon = getItemIcon(activeId);
                  return <Icon className="w-4 h-4 text-amber-600" />;
                })()}
                <span className="text-[13px] font-bold text-gray-900">{activeId}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-white flex items-center justify-between shrink-0">
          <div>
            {error ? (
              <span className="text-[12px] font-medium text-red-600">{error}</span>
            ) : (
              <span className="text-[12px] text-gray-500">Changes will apply across the application sidebar once saved.</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button 
              type="button"
              onClick={onClose} 
              disabled={saving}
              className="px-4 h-[38px] text-[13px] font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg border border-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button 
              type="button"
              onClick={save} 
              disabled={saving} 
              className="px-5 h-[38px] text-[13px] font-bold bg-[#f5b800] hover:bg-[#e6aa00] text-black rounded-lg flex items-center gap-2 shadow-sm transition-colors disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save Layout'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
