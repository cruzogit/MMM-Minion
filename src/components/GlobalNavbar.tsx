'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Home, Briefcase, Target, LayoutGrid, TreePine, CheckCircle2, Users, UserCog, BookOpen, Gift, Library, Search, ChevronUp, LogOut, Menu, X, PanelLeftClose, KeyRound, ClipboardList, Handshake, FileText, Package, Boxes, Wrench, Wallet, HandCoins, CalendarCheck, LayoutTemplate, type LucideIcon } from 'lucide-react';
import { NAV_ITEMS, snapshotCanViewAny } from '@/lib/rbac/catalog';
import { useSession, signOut } from 'next-auth/react';
import SidebarLayoutEditor from './SidebarLayoutEditor';
import { useEffect, useState, useSyncExternalStore } from 'react';

const NAV_ICONS: Record<string, LucideIcon> = {
  "/": Home,
  "/leads": ClipboardList,
  "/deals": Handshake,
  "/quotes": FileText,
  "/items": Package,
  "/material-vendors": Boxes,
  "/service-vendors": Wrench,
  "/pre-payments": Wallet,
  "/payment-collections": HandCoins,
  "/attendance": CalendarCheck,
  "/projects": LayoutGrid,
  "/tasks": CheckCircle2,
  "/team": Users,
  "/users": UserCog,
};

// "Hide menu": the whole navigator can be put away; the choice is remembered in this browser.
const HIDDEN_KEY = 'minion.sidebar.hidden';
const hiddenListeners = new Set<() => void>();
let hiddenMemory: boolean | null = null;

function getHidden() {
  if (hiddenMemory !== null) return hiddenMemory;
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function setHiddenPreference(value: boolean) {
  hiddenMemory = value;
  try {
    localStorage.setItem(HIDDEN_KEY, value ? '1' : '0');
  } catch {}
  hiddenListeners.forEach(listener => listener());
}

function subscribeHidden(listener: () => void) {
  hiddenListeners.add(listener);
  return () => {
    hiddenListeners.delete(listener);
  };
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-10 h-10 flex items-center justify-center shrink-0">
        <svg width="32" height="32" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Outer Triangle */}
          <path d="M50 15L90 85H10L50 15Z" stroke="#FFCC00" strokeWidth="6" strokeLinejoin="round" />
          {/* Inner Triangle */}
          <path d="M50 35L75 78H25L50 35Z" stroke="#FFCC00" strokeWidth="6" strokeLinejoin="round" />
          {/* Bottom Line */}
          <path d="M10 95H90" stroke="#FFCC00" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </div>
      {!compact && (
        <div className="flex flex-col justify-center min-w-0">
          <span className="text-[18px] font-bold leading-none text-white tracking-wide">MINION</span>
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mt-1 truncate">SMART HOME SOLUTIONS</span>
        </div>
      )}
    </div>
  );
}

export default function GlobalNavbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const router = useRouter();
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [layout, setLayout] = useState<any[] | null>(null);

  useEffect(() => {
    fetch('/api/settings/sidebar')
      .then(res => res.json())
      .then(data => setLayout(data.layout || []))
      .catch(() => setLayout([]));
  }, []);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: the sidebar rests as a slim icon strip and opens while the pointer (or keyboard focus) is on it
  const [expanded, setExpanded] = useState(false);
  // Right after "Show menu" the pointer is still where the strip appears; keep it closed until the pointer really moves
  const [holdClosed, setHoldClosed] = useState<{ x: number; y: number } | null>(null);
  const hidden = useSyncExternalStore(subscribeHidden, getHidden, () => false);
  const [lastPathname, setLastPathname] = useState(pathname);

  // Close the mobile drawer and profile menu after navigating
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
    setDropdownOpen(false);
  }

  const permissions = session?.user?.permissions || [];

  // UX only: the server enforces the same rules on every request
  const visibleNavItems = NAV_ITEMS
    .filter(item => snapshotCanViewAny(permissions, item.modules))
    .map(item => ({ ...item, icon: NAV_ICONS[item.href] ?? Home }));

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/login');
  };

  // Session revoked on the server (deactivated, password reset, expired): sign out locally
  const sessionInvalid = !!session?.user?.invalid;
  useEffect(() => {
    if (sessionInvalid) {
      signOut({ redirect: false }).then(() => router.push('/login?expired=1'));
    }
  }, [sessionInvalid, router]);

  // The page a customer opens with a quote's share link and the print page of a quote have no navigator
  if (pathname === '/login' || pathname === '/unauthorized' || pathname === '/forgot-password' || pathname === '/account/change-password' || pathname?.startsWith('/q/') || /^\/quotes\/[^/]+\/print$/.test(pathname ?? '')) {
    return null;
  }

  // The mobile drawer always shows labels; the desktop sidebar can collapse to icons
  const renderSidebarContent = (isCompact: boolean, desktop = false) => (
    <div className="flex flex-col h-full">
      {/* Logo + collapse toggle */}
      <div className={`h-20 flex items-center border-b border-[#292B30] shrink-0 ${isCompact ? 'justify-center px-2' : 'justify-between px-5'}`}>
        <Link href="/" aria-label="Minion home">
          <Logo compact={isCompact} />
        </Link>
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-gray-400 hover:text-white transition-colors"
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Search + notifications */}
      <div className={`flex gap-2 px-3 pt-4 ${isCompact ? 'flex-col items-center' : 'items-center'}`}>
        <button
          className={`flex items-center gap-3 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a1b1e] transition-colors ${isCompact ? 'p-2.5' : 'flex-1 px-3 py-2.5 bg-[#0D0D0F] border border-[#292B30]'}`}
          title="Search"
        >
          <Search className="w-4 h-4 shrink-0" />
          {!isCompact && <span className="text-[12px] font-medium">Search</span>}
        </button>
        <button
          onClick={() => setLayoutEditorOpen(true)}
          className="p-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#1a1b1e] transition-colors"
          title="Edit Page Layout"
          aria-label="Edit Page Layout"
        >
          <LayoutTemplate className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 space-y-1">
        {(() => {
          const renderNavLink = (item: (typeof visibleNavItems)[0]) => {
            const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.label}
                href={item.href}
                title={isCompact ? item.label : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setMobileOpen(false)}
                className={`relative flex items-center gap-3 rounded-lg transition-colors group ${
                  isCompact ? 'justify-center h-11' : 'px-3 min-h-11 py-1'
                } ${
                  isActive ? 'bg-yellow-400/10 text-yellow-400' : 'text-gray-400 hover:text-gray-200 hover:bg-[#1a1b1e]'
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-yellow-400 rounded-r-full" />
                )}
                <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-yellow-400' : 'text-gray-400 group-hover:text-gray-200'} transition-colors`} />
                {!isCompact && <span className="text-[12px] font-bold tracking-wider leading-tight">{item.label}</span>}
              </Link>
            );
          };

          if (layout && layout.length > 0) {
            const assignedLabels = new Set(layout.flatMap((g: any) => g.items || []));
            const remaining = visibleNavItems.filter(i => !assignedLabels.has(i.label));

            return (
              <>
                {layout.map((group: any) => {
                  const groupItems = (group.items || [])
                    .map((label: string) => visibleNavItems.find(i => i.label === label))
                    .filter(Boolean);
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={group.id} className="mb-3">
                      {!isCompact && (
                        <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                          {group.title}
                        </div>
                      )}
                      {isCompact && <div className="w-6 h-px bg-[#292B30] mx-auto my-2" />}
                      <div className="space-y-1">
                        {groupItems.map(renderNavLink)}
                      </div>
                    </div>
                  );
                })}
                {remaining.length > 0 && (
                  <div className="mb-3">
                    {!isCompact && (
                      <div className="px-3 pt-2 pb-1 text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                        MORE
                      </div>
                    )}
                    {isCompact && <div className="w-6 h-px bg-[#292B30] mx-auto my-2" />}
                    <div className="space-y-1">
                      {remaining.map(renderNavLink)}
                    </div>
                  </div>
                )}
              </>
            );
          }

          return visibleNavItems.map(renderNavLink);
        })()}
      </nav>

      {/* Hide menu (desktop): puts the whole navigator away; the menu icon brings it back */}
      {desktop && (
        <div className="px-3 pb-2 shrink-0">
          <button
            onClick={() => { setExpanded(false); setDropdownOpen(false); setHiddenPreference(true); }}
            aria-label="Hide menu"
            title="Hide menu"
            className={`w-full flex items-center gap-3 rounded-lg p-2 text-gray-500 hover:text-white hover:bg-[#1a1b1e] transition-colors ${isCompact ? 'justify-center' : ''}`}
          >
            <PanelLeftClose className="w-4 h-4 shrink-0" />
            {!isCompact && <span className="text-[11px] font-semibold tracking-wider">HIDE MENU</span>}
          </button>
        </div>
      )}

      {/* Profile */}
      <div className="border-t border-[#292B30] p-3 shrink-0">
        {session?.user ? (
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className={`w-full flex items-center gap-3 rounded-lg p-2 hover:bg-[#1a1b1e] transition-colors group ${isCompact ? 'justify-center' : ''}`}
              title={isCompact ? session.user.name || 'User' : undefined}
            >
              <div className="w-9 h-9 rounded-full bg-[#3B2E15] flex items-center justify-center shrink-0">
                <span className="text-[13px] font-bold text-yellow-400">
                  {session.user.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              {!isCompact && (
                <>
                  <div className="flex flex-col items-start min-w-0 flex-1">
                    <span className="text-[10px] text-gray-400 font-medium leading-tight truncate max-w-full">
                      {session.user.role || 'User'}
                    </span>
                    <span className="text-[13px] font-bold text-white leading-tight truncate max-w-full">
                      {session.user.name || 'User'}
                    </span>
                  </div>
                  <ChevronUp className={`w-4 h-4 text-gray-500 group-hover:text-white transition-all ${dropdownOpen ? '' : 'rotate-180'}`} />
                </>
              )}
            </button>
            {dropdownOpen && (
              <div className={`absolute bottom-full mb-2 w-48 bg-[#1a1b1e] border border-[#292B30] rounded-lg shadow-lg py-1 z-50 ${isCompact ? 'left-0' : 'left-0 right-0 w-auto'}`}>
                <Link href="/account" className="block px-4 py-2 text-sm text-gray-300 hover:bg-[#292B30] hover:text-white">
                  My Profile
                </Link>
                <Link href="/account/change-password" className="flex items-center gap-2 px-4 py-2 text-sm text-gray-300 hover:bg-[#292B30] hover:text-white">
                  <KeyRound className="w-4 h-4" />
                  Change Password
                </Link>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-[#292B30] hover:text-red-300 flex items-center gap-2"
                >
                  <LogOut className="w-4 h-4" />
                  Logout
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link href="/login" className={`block text-sm font-medium text-yellow-400 hover:text-yellow-300 ${isCompact ? 'text-center' : 'px-2'}`}>
            Sign In
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header data-sidebar className="lg:hidden sticky top-0 z-30 h-16 bg-[#111113] border-b border-[#292B30] px-4 flex items-center justify-between">
        <button
          onClick={() => setMobileOpen(true)}
          className="text-gray-300 hover:text-white transition-colors p-1 -ml-1"
          aria-label="Open menu"
        >
          <Menu className="w-6 h-6" />
        </button>
        <Link href="/" aria-label="Minion home">
          <Logo />
        </Link>
        <button
          onClick={() => setLayoutEditorOpen(true)}
          className="text-gray-400 hover:text-white transition-colors p-1"
          title="Edit Page Layout"
          aria-label="Edit Page Layout"
        >
          <LayoutTemplate className="w-5 h-5" />
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div data-sidebar className="lg:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-[#111113] border-r border-[#292B30] shadow-2xl">
            {renderSidebarContent(false)}
          </aside>
        </div>
      )}

      {/* Desktop, hidden: only a small menu icon is left; clicking it brings the icon strip back.
          It sits at the same height as "Hide menu" does above the profile avatar (77px profile block + 8px gap + half of the 32px button = 101px from the bottom; the 24px button needs 89px under it) */}
      {hidden && (
        <div data-sidebar className="hidden lg:flex flex-col justify-end sticky top-0 h-screen w-7 shrink-0 z-40 bg-[#111113]">
          <button
            onClick={e => { setHoldClosed({ x: e.clientX, y: e.clientY }); setHiddenPreference(false); }}
            aria-label="Show menu"
            title="Show menu"
            className="mb-[89px] mx-auto w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-[#1a1b1e] transition-colors"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Desktop sidebar: a fixed 76px strip keeps the page from shifting; the panel opens over it on hover or focus */}
      {!hidden && (
        <div className="hidden lg:block sticky top-0 h-screen w-[76px] shrink-0 z-40">
          <aside
            data-sidebar
            onMouseEnter={() => { if (!holdClosed) setExpanded(true); }}
            onMouseMove={e => { if (holdClosed && Math.hypot(e.clientX - holdClosed.x, e.clientY - holdClosed.y) > 6) { setHoldClosed(null); setExpanded(true); } }}
            onMouseLeave={() => { setExpanded(false); setDropdownOpen(false); setHoldClosed(null); }}
            // Keyboard users tabbing in open it; focus left over from a mouse click does not
            onFocus={e => { if (!holdClosed && e.target.matches(':focus-visible')) setExpanded(true); }}
            onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setExpanded(false); setDropdownOpen(false); } }}
            className={`absolute left-0 top-0 h-screen bg-[#111113] border-r border-[#292B30] transition-[width,box-shadow] duration-200 ${
              expanded ? 'w-60 shadow-2xl shadow-black/40' : 'w-[76px]'
            }`}
          >
            {renderSidebarContent(!expanded, true)}
          </aside>
        </div>
      )}

      {layoutEditorOpen && (
        <SidebarLayoutEditor
          onClose={() => setLayoutEditorOpen(false)}
          onSaved={() => {
            fetch('/api/settings/sidebar')
              .then(res => res.json())
              .then(data => setLayout(data.layout || []))
              .catch(() => setLayout([]));
          }}
        />
      )}
    </>
  );
}
