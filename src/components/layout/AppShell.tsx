import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  GitBranch,
  History,
  FileCode2,
  Plug,
  Settings,
  Menu,
  X,
  TerminalSquare,
  Search,
  Plus,
  Zap,
  ArrowRight,
  GitCommit,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { getButtonClasses } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { cn } from '../../utils/cn';
import { formatRelativeDate } from '../../utils/dateUtils';

interface AppShellProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: Array<{ label: string; to?: string }>;
  actions?: React.ReactNode;
  children: React.ReactNode;
  bottomBar?: React.ReactNode;
}

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/projects', label: 'Projects', icon: GitBranch },
  { to: '/timeline', label: 'Timeline', icon: History },
  { to: '/memory', label: 'Project summary', icon: FileCode2 },
  { to: '/integrations', label: 'Connections', icon: Plug },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppShell({
  title,
  subtitle,
  breadcrumbs,
  actions,
  children,
  bottomBar,
}: AppShellProps) {
  const { user, userProfile } = useAuth();
  const { integrations, repositories, activityEvents } = useWorkspace();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [quickSwitchOpen, setQuickSwitchOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  const displayName =
    userProfile?.displayName || user?.displayName || user?.email?.split('@')[0] || 'Developer';
  const email = userProfile?.email || user?.email || '';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'BL';

  const connectedIntegrations = integrations.filter((i) => i.status === 'connected');
  const activeRepos = repositories.filter((r) => r.status === 'active');

  const currentRepoMatch = location.pathname.match(/^\/projects\/([^/]+)/);
  const currentRepoId = currentRepoMatch?.[1];
  const resumeTarget = currentRepoId ? `/projects/${currentRepoId}/memory` : '/memory';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSwitchOpen((prev) => !prev);
        setQuickQuery('');
        return;
      }

      if (!isInput && e.altKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        navigate(resumeTarget);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigate, resumeTarget]);

  const filteredQuickItems = useMemo(() => {
    const q = quickQuery.trim().toLowerCase();
    const routeResults = NAV_ITEMS.filter(
      (item) => !q || item.label.toLowerCase().includes(q)
    ).map((item) => ({
      id: `route-${item.to}`,
      label: item.label,
      sublabel: 'Page',
      to: item.to,
      kind: 'route' as const,
    }));

    const repoResults = repositories
      .filter(
        (repo) =>
          !q ||
          repo.fullName.toLowerCase().includes(q) ||
          repo.primaryLanguage.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .map((repo) => ({
        id: `repo-${repo.id}`,
        label: repo.fullName,
        sublabel: `${repo.primaryLanguage || 'Repository'} · ${repo.defaultBranch}`,
        to: `/projects/${repo.id}`,
        kind: 'repo' as const,
      }));

    return { routeResults, repoResults };
  }, [quickQuery, repositories]);

  const isNavItemActive = (to: string, routerActive: boolean) => {
    if (to === '/projects') {
      return (
        routerActive ||
        (location.pathname.startsWith('/projects/') && !location.pathname.endsWith('/memory'))
      );
    }
    if (to === '/memory') {
      return routerActive || location.pathname.endsWith('/memory');
    }
    return routerActive;
  };

  const getBadgeCount = (to: string): string | null => {
    if (to === '/projects' && repositories.length > 0) return String(repositories.length);
    if (to === '/timeline' && activityEvents.length > 0) return String(activityEvents.length);
    if (to === '/integrations' && connectedIntegrations.length > 0) {
      return String(connectedIntegrations.length);
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-[#080908] text-[#F3F5EF] flex flex-col lg:flex-row">
      {/* Desktop Fixed Sidebar (252px) */}
      <aside className="hidden lg:flex lg:w-[252px] lg:flex-col lg:fixed lg:inset-y-0 lg:left-0 border-r border-[#252D24] bg-[#0D0F0D] z-30">
        <div className="h-16 px-5 flex items-center justify-between border-b border-[#252D24]">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-2.5 text-lg font-display font-bold tracking-tight text-[#FCFFEC] whitespace-nowrap shrink-0"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#B8F34A] text-[#090B09]">
              <TerminalSquare className="w-4 h-4" aria-hidden="true" />
            </span>
            <span>BuildLog</span>
          </Link>
          <span className="text-[11px] font-mono text-[#929B90]">v2.0</span>
        </div>

        {/* Quick Switcher Trigger */}
        <div className="px-3.5 pt-4 pb-2">
          <button
            type="button"
            onClick={() => {
              setQuickQuery('');
              setQuickSwitchOpen(true);
            }}
            className="w-full flex items-center justify-between gap-2 rounded-lg border border-[#252D24] bg-[#121512] px-3 py-2 text-xs text-[#929B90] hover:text-[#F3F5EF] hover:border-[#344032] transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-2 truncate">
              <Search className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Go to…</span>
            </span>
            <kbd className="font-mono text-[10px] text-[#929B90] bg-[#181B18] border border-[#252D24] rounded px-1.5 py-0.5 shrink-0">
              ⌘K
            </kbd>
          </button>
        </div>

        <nav
          aria-label="Primary workspace navigation"
          className="flex-1 px-3 py-2 space-y-1 overflow-y-auto"
        >
          <p className="px-3 pb-1 text-[10px] font-mono uppercase tracking-wider text-[#929B90]/80">
            Workspace
          </p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = getBadgeCount(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150 whitespace-nowrap',
                    isNavItemActive(item.to, isActive)
                      ? 'bg-[#181B18] text-[#B8F34A] border border-[#B8F34A]/25'
                      : 'text-[#929B90] hover:text-[#F3F5EF] hover:bg-[#121512] border border-transparent'
                  )
                }
              >
                <span className="inline-flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {count && (
                  <span className="text-[11px] font-mono tabular-nums text-[#929B90] shrink-0">
                    {count}
                  </span>
                )}
              </NavLink>
            );
          })}

          {/* Tracked Repositories Quick List */}
          <div className="pt-5">
            <div className="px-3 pb-1.5 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-[#929B90]/80">
                Your projects
              </span>
              <Link
                to="/integrations"
                className="text-[10px] font-mono text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
              >
                + Add
              </Link>
            </div>
            {repositories.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[#929B90]/75">
                No projects yet.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {repositories.slice(0, 5).map((repo) => {
                  const isRepoActive = location.pathname.startsWith(`/projects/${repo.id}`);
                  return (
                    <li key={repo.id}>
                      <Link
                        to={`/projects/${repo.id}`}
                        className={cn(
                          'flex items-center justify-between gap-2 px-3 py-1.5 rounded-md text-xs transition-colors',
                          isRepoActive
                            ? 'bg-[#181B18] text-[#FCFFEC]'
                            : 'text-[#929B90] hover:text-[#F3F5EF] hover:bg-[#121512]'
                        )}
                      >
                        <span className="inline-flex items-center gap-2 min-w-0">
                          <GitCommit className="w-3 h-3 text-[#B8F34A]/80 shrink-0" aria-hidden="true" />
                          <span className="truncate font-mono text-[11px]">{repo.fullName}</span>
                        </span>
                        {repo.lastSyncedAt && (
                          <span className="text-[10px] font-mono tabular-nums text-[#929B90]/70 shrink-0">
                            {formatRelativeDate(repo.lastSyncedAt).replace(' ago', '')}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </nav>

        <div className="p-3.5 border-t border-[#252D24]">
          <Link
            to="/settings"
            className="flex items-center gap-3 rounded-xl p-2 hover:bg-[#121512] border border-transparent hover:border-[#252D24] transition-colors"
          >
            <div className="h-8 w-8 rounded-lg bg-[#181B18] border border-[#252D24] flex items-center justify-center text-xs font-display font-bold text-[#B8F34A] shrink-0">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[#FCFFEC] truncate">{displayName}</p>
              <p className="text-xs text-[#929B90] truncate">{email}</p>
            </div>
          </Link>
        </div>
      </aside>

      {/* Mobile Compact Header (<15% height) */}
      <header className="lg:hidden sticky top-0 z-40 h-14 border-b border-[#252D24] bg-[#0D0F0D]/95 backdrop-blur-sm px-4 flex items-center justify-between gap-3">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 text-base font-display font-bold tracking-tight text-[#FCFFEC] whitespace-nowrap shrink-0"
        >
          <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[#B8F34A] text-[#090B09]">
            <TerminalSquare className="w-3.5 h-3.5" aria-hidden="true" />
          </span>
          <span>BuildLog</span>
        </Link>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={resumeTarget}
            className={getButtonClasses('primary', 'sm')}
          >
            <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Resume</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-[#252D24] bg-[#121512] text-[#F3F5EF] cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 top-14 z-30 bg-black/75"
          onClick={() => setMobileMenuOpen(false)}
        >
          <nav
            aria-label="Mobile navigation"
            className="bg-[#0D0F0D] border-b border-[#252D24] p-4 space-y-1 max-h-[75vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors',
                      isNavItemActive(item.to, isActive)
                        ? 'bg-[#181B18] text-[#B8F34A] border border-[#B8F34A]/25'
                        : 'text-[#929B90] hover:text-[#F3F5EF] hover:bg-[#121512]'
                    )
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-[252px] min-w-0 flex flex-col">
        {/* Desktop Top Utility Strip */}
        <div className="hidden lg:flex h-16 border-b border-[#252D24] bg-[#0D0F0D]/90 px-8 items-center justify-between gap-4">
          <Link
            to="/integrations"
            className="inline-flex items-center gap-2 text-xs text-[#929B90] hover:text-[#F3F5EF] transition-colors whitespace-nowrap"
          >
            <Plug
              className={cn(
                'w-3.5 h-3.5 shrink-0',
                connectedIntegrations.length > 0 ? 'text-[#B8F34A]' : 'text-amber-300'
              )}
              aria-hidden="true"
            />
            <span>
              {connectedIntegrations.length > 0
                ? `GitHub connected · tracking ${activeRepos.length} ${
                    activeRepos.length === 1 ? 'project' : 'projects'
                  }`
                : 'GitHub not connected yet. Add a project to start.'}
            </span>
          </Link>

          <div className="flex items-center gap-3 shrink-0">
            <Link to="/integrations" className={getButtonClasses('secondary', 'sm')}>
              <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Add a project</span>
            </Link>
            <Link to={resumeTarget} className={getButtonClasses('primary', 'sm')}>
              <Zap className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Catch up</span>
            </Link>
          </div>
        </div>

        {/* Contextual Page Header */}
        <div className="border-b border-[#252D24] bg-[#0A0C0A]">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="min-w-0">
              {breadcrumbs && breadcrumbs.length > 0 && (
                <nav
                  aria-label="Breadcrumb"
                  className="mb-1.5 flex items-center gap-2 text-xs font-mono text-[#929B90]"
                >
                  {breadcrumbs.map((crumb, idx) => (
                    <React.Fragment key={`${crumb.label}-${idx}`}>
                      {idx > 0 && <span aria-hidden="true">/</span>}
                      {crumb.to ? (
                        <Link to={crumb.to} className="hover:text-[#F3F5EF] transition-colors truncate">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span className="text-[#F3F5EF] truncate">{crumb.label}</span>
                      )}
                    </React.Fragment>
                  ))}
                </nav>
              )}
              <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#FCFFEC] truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="mt-1 text-sm text-[#929B90] leading-relaxed">{subtitle}</p>
              )}
            </div>

            {actions && (
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>
            )}
          </div>
        </div>

        <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {children}
        </main>

        {bottomBar}
      </div>

      {/* Quick Switch Modal (Cmd/Ctrl+K) */}
      <Modal
        open={quickSwitchOpen}
        onClose={() => setQuickSwitchOpen(false)}
        title="Go to…"
        description="Jump to a page or one of your projects."
        maxWidthClass="max-w-lg"
      >
        <div className="space-y-4">
          <div className="relative">
            <Search
              className="w-4 h-4 text-[#929B90] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              autoFocus
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Type a page or project name…"
              aria-label="Search pages and projects"
              className="min-h-[42px] w-full rounded-lg border border-[#252D24] bg-[#080908] pl-10 pr-3.5 py-2 text-sm text-[#F3F5EF] placeholder:text-[#929B90]/60 focus:outline-none focus:border-[#B8F34A]"
            />
          </div>

          <div className="space-y-3 max-h-72 overflow-y-auto">
            {filteredQuickItems.repoResults.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#929B90] mb-1.5">
                  Projects
                </p>
                <ul className="space-y-1">
                  {filteredQuickItems.repoResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickSwitchOpen(false);
                          navigate(item.to);
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#181B18] transition-colors cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[#FCFFEC] truncate">{item.label}</p>
                          <p className="text-xs text-[#929B90] truncate">{item.sublabel}</p>
                        </div>
                        <ArrowRight className="w-3.5 h-3.5 text-[#929B90] shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {filteredQuickItems.routeResults.length > 0 && (
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#929B90] mb-1.5">
                  Pages
                </p>
                <ul className="space-y-1">
                  {filteredQuickItems.routeResults.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setQuickSwitchOpen(false);
                          navigate(item.to);
                        }}
                        className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-[#181B18] transition-colors cursor-pointer"
                      >
                        <span className="text-sm font-medium text-[#FCFFEC]">{item.label}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-[#929B90] shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {filteredQuickItems.repoResults.length === 0 &&
              filteredQuickItems.routeResults.length === 0 && (
                <p className="text-xs text-[#929B90] text-center py-6">
                  Nothing matches that.
                </p>
              )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
