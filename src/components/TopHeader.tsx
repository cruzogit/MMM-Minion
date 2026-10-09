'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { 
  Menu, 
  Search, 
  Bell, 
  ChevronDown, 
  User, 
  Shield, 
  LogOut,
  LayoutTemplate
} from 'lucide-react';
import { allNavItems } from './Sidebar';
import SidebarLayoutEditor from './SidebarLayoutEditor';

interface TopHeaderProps {
  onOpenMobile: () => void;
  isCollapsed: boolean;
}

export default function TopHeader({ onOpenMobile, isCollapsed }: TopHeaderProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const router = useRouter();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = !!(session?.user as any)?.isSuperAdmin;

  // Find current active item title
  const currentNav = allNavItems.find(
    (item) => pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href))
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    await signOut({ redirect: false });
    router.push('/login');
  };

  return (
    <header className="h-16 w-full bg-[#111113]/95 backdrop-blur-md border-b border-[#292B30] px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shrink-0">
      {/* Left Area: Mobile Menu Trigger + Breadcrumb */}
      <div className="flex items-center gap-3">
        {/* Mobile Hamburger Menu */}
        <button
          onClick={onOpenMobile}
          aria-label="Open navigation menu"
          className="lg:hidden text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Current Active Section Badge */}
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-block text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
            PANEL
          </span>
          <span className="hidden sm:inline-block text-gray-600">/</span>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-[13px] font-bold text-white tracking-wide uppercase">
              {currentNav?.label || 'DASHBOARD'}
            </span>
          </div>
        </div>
      </div>

      {/* Center Area: Quick Global Search Input */}
      <div className="hidden md:flex items-center flex-1 max-w-md mx-6">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search leads, projects, tasks... (Press Ctrl + K)"
            className="w-full bg-[#17181C] text-sm text-gray-200 placeholder-gray-400 pl-10 pr-12 py-1.5 rounded-lg border border-[#292B30] focus:outline-none focus:border-yellow-400 transition-colors"
          />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-gray-400 bg-[#22242A] border border-[#2E3138] px-1.5 py-0.5 rounded">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Right Area: Search (Mobile), Notifications, User Profile */}
      <div className="flex items-center gap-3 sm:gap-4">
        {/* Mobile Search Button */}
        <button 
          aria-label="Search"
          className="md:hidden text-gray-400 hover:text-white p-2 rounded-lg hover:bg-white/5 transition-colors"
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Edit Layout Button (Always visible as requested) */}
        <button 
          onClick={() => setLayoutEditorOpen(true)}
          className="flex items-center gap-2 text-gray-400 hover:text-white px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-sm font-medium border border-transparent hover:border-[#292B30]"
        >
          <LayoutTemplate className="w-4 h-4" />
          <span className="hidden sm:inline">Edit Page Layout</span>
        </button>

        <div className="w-px h-6 bg-[#292B30]" />

        {/* Profile Dropdown */}
        {session?.user ? (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setProfileDropdownOpen((prev) => !prev)}
              aria-label="User profile options"
              className="flex items-center gap-2.5 p-1 rounded-lg hover:bg-white/5 transition-colors group"
            >
              <div className="w-8 h-8 rounded-full bg-[#3B2E15] border border-yellow-400/40 flex items-center justify-center shrink-0">
                <span className="text-[12px] font-bold text-yellow-400">
                  {session.user.name?.[0]?.toUpperCase() || 'U'}
                </span>
              </div>
              <div className="hidden sm:flex flex-col items-start text-left">
                <span className="text-[10px] text-gray-400 font-semibold tracking-wider uppercase leading-tight">
                  {(session.user as any)?.role || 'USER'}
                </span>
                <span className="text-[12px] font-bold text-white group-hover:text-yellow-400 transition-colors leading-tight">
                  {session.user.name || 'User'}
                </span>
              </div>
              <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
            </button>

            {/* Dropdown Menu */}
            {profileDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-[#16171B] border border-[#292B30] rounded-xl shadow-2xl py-2 z-50">
                <div className="px-4 py-2.5 border-b border-[#292B30]">
                  <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">Signed in as</p>
                  <p className="text-sm font-bold text-white truncate">{session.user.email}</p>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-400/10 text-yellow-400 border border-yellow-400/20 uppercase">
                    {(session.user as any)?.role || 'USER'}
                  </span>
                </div>

                <div className="py-1">
                  <Link
                    href="/"
                    onClick={() => setProfileDropdownOpen(false)}
                    className="flex items-center gap-2.5 px-4 py-2 text-[13px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                  >
                    <User className="w-4 h-4 text-gray-400" />
                    Dashboard Home
                  </Link>

                  {isSuperAdmin && (
                    <Link
                      href="/admin/access/roles"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="flex items-center gap-2.5 px-4 py-2 text-[13px] text-gray-300 hover:bg-white/5 hover:text-white transition-colors"
                    >
                      <Shield className="w-4 h-4 text-yellow-400" />
                      Access Control
                    </Link>
                  )}
                </div>

                <div className="pt-1 border-t border-[#292B30]">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-4 py-2 text-[13px] text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/login"
            className="text-[12px] font-bold bg-yellow-400 hover:bg-yellow-300 text-black px-3.5 py-1.5 rounded-lg transition-all"
          >
            Sign In
          </Link>
        )}
      </div>

      {layoutEditorOpen && (
        <SidebarLayoutEditor onClose={() => setLayoutEditorOpen(false)} onSaved={() => {}} />
      )}
    </header>
  );
}
