import { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../hooks/useSocket';
import {
  LayoutDashboard, Monitor, Image, ListVideo, Calendar, FolderOpen,
  Settings, LogOut, ChevronLeft, Wifi, WifiOff, Menu,
  LayoutGrid, Puzzle, BookTemplate, Download, Users,
} from 'lucide-react';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true, roles: ['admin', 'editor', 'viewer'] },
  { to: '/devices', icon: Monitor, label: 'Devices', roles: ['admin', 'editor', 'viewer'] },
  { to: '/walls', icon: LayoutGrid, label: 'Display Walls', roles: ['admin', 'editor'] },
  { to: '/assets', icon: Image, label: 'Assets', roles: ['admin', 'editor'] },
  { to: '/playlists', icon: ListVideo, label: 'Playlists', roles: ['admin', 'editor'] },
  { to: '/templates', icon: BookTemplate, label: 'Templates', roles: ['admin', 'editor'] },
  { to: '/widgets', icon: Puzzle, label: 'Widgets', roles: ['admin', 'editor'] },
  { to: '/schedules', icon: Calendar, label: 'Schedules', roles: ['admin', 'editor'] },
  { to: '/groups', icon: FolderOpen, label: 'Groups', roles: ['admin', 'editor'] },
  { to: '/users', icon: Users, label: 'Users', roles: ['admin'] },
  { to: '/downloads', icon: Download, label: 'Setup & Downloads', roles: ['admin', 'editor'] },
  { to: '/settings', icon: Settings, label: 'Settings', roles: ['admin', 'editor', 'viewer'] },
];

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNavItems = navItems.filter(({ roles }) => roles.includes(user?.role));

  const handleLogout = () => { logout(); navigate('/login'); };

  const SidebarContent = () => (
    <>
      <div className={`flex items-center gap-3 px-4 h-16 border-b border-surface-border shrink-0 ${collapsed ? 'justify-center' : ''}`}>
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-violet-500 flex items-center justify-center">
              <span className="text-white font-bold text-sm">S</span>
            </div>
            <div>
              <h1 className="text-sm font-semibold text-zinc-100 leading-tight">SignIT</h1>
              <p className="text-[10px] text-zinc-500 leading-tight">Digital Signage</p>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-violet-500 flex items-center justify-center">
            <span className="text-white font-bold text-sm">S</span>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {visibleNavItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200
              ${isActive
                ? 'bg-accent/10 text-accent'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface-hover'
              } ${collapsed ? 'justify-center' : ''}`
            }
          >
            <Icon size={18} />
            {!collapsed && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="px-2 py-3 border-t border-surface-border space-y-1 shrink-0">
        <div className={`flex items-center gap-2 px-3 py-1.5 ${collapsed ? 'justify-center' : ''}`}>
          {connected
            ? <Wifi size={14} className="text-emerald-400" />
            : <WifiOff size={14} className="text-zinc-500" />
          }
          {!collapsed && (
            <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          )}
        </div>

        {!collapsed && user && (
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-zinc-300 truncate">{user.name}</p>
            <p className="text-xs text-zinc-500 truncate">{user.email}</p>
          </div>
        )}

        <button
          onClick={handleLogout}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-zinc-400 hover:text-red-400
            hover:bg-red-500/10 transition-all duration-200 w-full ${collapsed ? 'justify-center' : ''}`}
        >
          <LogOut size={18} />
          {!collapsed && <span>Sign Out</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="h-screen flex bg-[#09090b]">
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`fixed z-50 lg:relative lg:z-auto h-full bg-surface border-r border-surface-border
        flex flex-col transition-all duration-300 ease-out
        ${collapsed ? 'w-16' : 'w-60'}
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <SidebarContent />
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex absolute -right-3 top-20 w-6 h-6 rounded-full bg-surface-overlay border
            border-surface-border items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <ChevronLeft size={12} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 flex items-center justify-between px-4 lg:px-6 border-b border-surface-border shrink-0 bg-surface/50 backdrop-blur-xl">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 -ml-2 text-zinc-400">
            <Menu size={20} />
          </button>
          <div />
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-violet-500 flex items-center justify-center">
              <span className="text-white text-xs font-semibold">{user?.name?.[0] || 'A'}</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6 max-w-[1400px] mx-auto w-full animate-fade-in">
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
