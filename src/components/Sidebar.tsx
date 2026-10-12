'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { 
  Home, 
  LayoutGrid, 
  CheckCircle2, 
  Users, 
  Shield, 
  ChevronLeft, 
  ChevronRight, 
  X, 
  LogOut,
  ClipboardList,
  Handshake,
  FileText,
  Package,
  Boxes,
  Wrench,
  Wallet,
  HandCoins,
  CalendarCheck,
  UserCog
} from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import { useState, useEffect } from 'react';
import type { SidebarGroup } from './SidebarLayoutEditor';

export interface NavItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  requiredPermission?: string;
}

export const allNavItems: NavItem[] = [
  { label: 'HOME', icon: Home, href: '/' },
  { label: 'LEADS', icon: ClipboardList, href: '/leads', requiredPermission: 'leads.view' },
  { label: 'DEALS', icon: Handshake, href: '/deals', requiredPermission: 'deals.view' },
  { label: 'QUOTES', icon: FileText, href: '/quotes', requiredPermission: 'quotes.view' },
  { label: 'ITEMS', icon: Package, href: '/items', requiredPermission: 'quotes.view' },
  { label: 'MATERIAL VENDOR', icon: Boxes, href: '/material-vendors', requiredPermission: 'vendors.view' },
  { label: 'SERVICE VENDOR', icon: Wrench, href: '/service-vendors', requiredPermission: 'vendors.view' },
  { label: 'PRE-PAYMENT RECORDS', icon: Wallet, href: '/pre-payments', requiredPermission: 'ppr.view' },
  { label: 'PAYMENT COLLECTION RECORDS', icon: HandCoins, href: '/payment-collections', requiredPermission: 'payments.view' },
  { label: 'ATTENDANCE', icon: CalendarCheck, href: '/attendance', requiredPermission: 'attendance.view' },
  { label: 'TASKS', icon: CheckCircle2, href: '/tasks', requiredPermission: 'tasks.view' },
  { label: 'PROJECTS', icon: LayoutGrid, href: '/projects', requiredPermission: 'projects.view' },
  { label: 'TEAM', icon: Users, href: '/team', requiredPermission: 'team.view' },
  { label: 'USERS', icon: UserCog, href: '/users', requiredPermission: 'users.view' },
];

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export default function Sidebar({
  isCollapsed,
  setIsCollapsed,
  isMobileOpen,
  setIsMobileOpen,
}: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const router = useRouter();

  const [layout, setLayout] = useState<SidebarGroup[] | null>(null);

  useEffect(() => {
    fetch('/api/settings/sidebar').then(res => res.json()).then(data => {
      setLayout(data.layout || []);
    }).catch(() => setLayout([]));
  }, []);

  const permissions = session?.user?.permissions ?? [];
  const isSuperAdmin = !!session?.user?.isSuperAdmin;

  const visibleNavItems = allNavItems.filter((item) => {
    if (!item.requiredPermission) return true;
    if (isSuperAdmin) return true;
    return permissions.includes(item.requiredPermission);
  });

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/login');
  };

  const navContent = (isMobile = false) => {
    const collapsed = !isMobile && isCollapsed;

    return (
      <div className="flex flex-col h-full bg-[#111113] select-none">
        {/* Brand Header */}
        <div className={`h-16 flex items-center border-b border-[#292B30] px-4 shrink-0 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}>
          <Link 
            href="/" 
            onClick={() => isMobile && setIsMobileOpen(false)}
            className="flex items-center gap-3 overflow-hidden group"
          >
            {/* Minion Triangle Logo */}
            <div className="w-8 h-8 flex items-center justify-center shrink-0">
              <svg width="28" height="28" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M50 15L90 85H10L50 15Z" stroke="#FFCC00" strokeWidth="6" strokeLinejoin="round" />
                <path d="M50 35L75 78H25L50 35Z" stroke="#FFCC00" strokeWidth="6" strokeLinejoin="round" />
                <path d="M10 95H90" stroke="#FFCC00" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </div>
            
            {!collapsed && (
              <div className="flex flex-col justify-center transition-opacity duration-200">
                <span className="text-[16px] font-bold leading-none text-white tracking-wide group-hover:text-yellow-400 transition-colors">
                  MINION
                </span>
                <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-widest mt-1">
                  SMART HOME SOLUTIONS
                </span>
              </div>
            )}
          </Link>

          {/* Desktop Collapse Toggle */}
          {!isMobile && (
            <button
              onClick={() => setIsCollapsed((prev) => !prev)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`text-gray-400 hover:text-white hover:bg-[#1f2126] p-1.5 rounded-md transition-colors ${
                collapsed ? 'hidden' : 'block'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          {/* Mobile Close Button */}
          {isMobile && (
            <button
              onClick={() => setIsMobileOpen(false)}
              aria-label="Close menu"
              className="text-gray-400 hover:text-white p-1.5 rounded-md"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto no-scrollbar py-4 px-2 space-y-1">
          {layout && layout.length > 0 ? (
            layout.map(group => {
              const groupItems = group.items.map((label: string) => visibleNavItems.find(n => n.label === label)).filter(Boolean) as NavItem[];
              if (groupItems.length === 0) return null;
              return (
                <div key={group.id} className="mb-4">
                  {!collapsed && (
                    <div className="px-3 pb-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {group.title}
                    </div>
                  )}
                  {collapsed && <div className="w-8 h-px bg-[#292B30] mx-auto my-2" />}
                  <div className="space-y-1">
                    {groupItems.map(item => renderNavItem(item, collapsed, isMobile))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="mb-4">
              {!collapsed && (
                <div className="px-3 pb-2 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                  MAIN MENU
                </div>
              )}
              <div className="space-y-1">
                {visibleNavItems.map(item => renderNavItem(item, collapsed, isMobile))}
              </div>
            </div>
          )}

          {/* Admin section if Super Admin */}
          {isSuperAdmin && (
            <>
              <div className="pt-4 pb-1">
                {!collapsed ? (
                  <div className="px-3 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                    SYSTEM
                  </div>
                ) : (
                  <div className="w-8 h-px bg-[#292B30] mx-auto my-1" />
                )}
              </div>
              <Link
                href="/admin/access/roles"
                onClick={() => isMobile && setIsMobileOpen(false)}
                title={collapsed ? 'ACCESS CONTROL' : undefined}
                className={`relative flex items-center rounded-lg transition-all group ${
                  collapsed ? 'justify-center py-3 px-2' : 'gap-3.5 px-3 py-2.5'
                } ${
                  pathname?.startsWith('/admin/access')
                    ? 'bg-yellow-400/10 text-yellow-400 font-bold border border-yellow-400/20'
                    : 'text-gray-400 hover:text-white hover:bg-white/5 font-medium'
                }`}
              >
                {pathname?.startsWith('/admin/access') && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-yellow-400 rounded-r-full" />
                )}
                <Shield className={`shrink-0 ${collapsed ? 'w-5 h-5' : 'w-4 h-4'}`} />
                {!collapsed && (
                  <span className="text-[12px] tracking-wide whitespace-nowrap">
                    ACCESS CONTROL
                  </span>
                )}
              </Link>
            </>
          )}
        </div>

        {/* Footer / User Profile Snippet */}
        <div className="border-t border-[#292B30] p-3 shrink-0">
          {session?.user ? (
            <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between gap-2'}`}>
              <div className="flex items-center gap-2.5 overflow-hidden">
                <div className="w-8 h-8 rounded-full bg-[#3B2E15] border border-yellow-400/30 flex items-center justify-center shrink-0">
                  <span className="text-[12px] font-bold text-yellow-400">
                    {session.user.name?.[0]?.toUpperCase() || 'U'}
                  </span>
                </div>
                {!collapsed && (
                  <div className="flex flex-col min-w-0">
                    <span className="text-[12px] font-bold text-white truncate leading-tight">
                      {session.user.name || 'User'}
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium truncate uppercase">
                      {session.user.role || 'User'}
                    </span>
                  </div>
                )}
              </div>

              {!collapsed && (
                <button
                  onClick={handleLogout}
                  title="Sign Out"
                  className="text-gray-400 hover:text-red-400 hover:bg-[#1a1b1e] p-1.5 rounded-md transition-colors shrink-0"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <Link
              href="/login"
              className={`flex items-center justify-center bg-yellow-400 hover:bg-yellow-300 text-black text-[12px] font-bold py-2 rounded-lg transition-all ${
                collapsed ? 'px-2' : 'px-4'
              }`}
            >
              {collapsed ? 'In' : 'Sign In'}
            </Link>
          )}

          {/* Collapsed Expand Trigger at Bottom */}
          {collapsed && !isMobile && (
            <button
              onClick={() => setIsCollapsed(false)}
              title="Expand sidebar"
              className="w-full mt-3 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5 py-1.5 rounded-md transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderNavItem = (item: NavItem, collapsed: boolean, isMobile: boolean) => {
    const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
    const Icon = item.icon;

    return (
      <Link
        key={item.label}
        href={item.href}
        onClick={() => isMobile && setIsMobileOpen(false)}
        title={collapsed ? item.label : undefined}
        className={`relative flex items-center rounded-lg transition-all group ${
          collapsed ? 'justify-center py-3 px-2' : 'gap-3.5 px-3 py-2.5'
        } ${
          isActive
            ? 'bg-yellow-400/10 text-yellow-400 font-bold border border-yellow-400/20'
            : 'text-gray-400 hover:text-white hover:bg-white/5 font-medium'
        }`}
      >
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-yellow-400 rounded-r-full shadow-[0_0_8px_rgba(255,204,0,0.5)]" />
        )}
        <Icon className={`shrink-0 transition-colors ${collapsed ? 'w-5 h-5' : 'w-4 h-4'} ${isActive ? 'text-yellow-400' : 'text-gray-400 group-hover:text-white'}`} />
        {!collapsed && <span className="text-[12px] tracking-wide whitespace-nowrap">{item.label}</span>}
      </Link>
    );
  };

  return (
    <>
      {/* Desktop Sidebar (Sticky, takes left side) */}
      <aside
        className={`hidden lg:block sticky top-0 h-screen shrink-0 border-r border-[#292B30] z-40 transition-all duration-300 ease-in-out ${
          isCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {navContent(false)}
      </aside>

      {/* Mobile Drawer (Slide-over with overlay) */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileOpen(false)}
          />

          {/* Drawer content */}
          <aside className="relative w-72 max-w-[85vw] h-full shadow-2xl z-10 border-r border-[#292B30]">
            {navContent(true)}
          </aside>
        </div>
      )}
    </>
  );
}
