import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  FileCode2,
  GitBranch,
  LayoutGrid,
  List,
  Plug,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button, getButtonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { RepositoryStatusLabel } from '../components/ui/StatusLabel';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import type { RepositoryStatus } from '../types/models';
import { formatRelativeDate } from '../utils/dateUtils';
import { parseFriendlyFirestoreError } from '../lib/firebase';

export function ProjectsPage() {
  const {
    repositories,
    activityEvents,
    activitySummaries,
    loading,
    syncingRepoId,
    syncRepositoryHistory,
  } = useWorkspace();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RepositoryStatus>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        if (document.activeElement !== searchRef.current) {
          e.preventDefault();
          searchRef.current?.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const countsByStatus = useMemo(() => {
    return {
      all: repositories.length,
      active: repositories.filter((r) => r.status === 'active').length,
      paused: repositories.filter((r) => r.status === 'paused').length,
      disconnected: repositories.filter((r) => r.status === 'disconnected').length,
    };
  }, [repositories]);

  const filteredRepos = useMemo(() => {
    const q = search.trim().toLowerCase();
    return repositories.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.fullName.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.objective?.toLowerCase().includes(q) ||
        r.primaryLanguage.toLowerCase().includes(q)
      );
    });
  }, [repositories, search, statusFilter]);

  const handleSync = async (repoId: string) => {
    const repo = repositories.find((r) => r.id === repoId);
    if (!repo) return;
    try {
      const result = await syncRepositoryHistory(repo);
      showToast(
        result.insertedCount > 0
          ? `Found ${result.insertedCount} new ${result.insertedCount === 1 ? 'update' : 'updates'} for ${repo.fullName}.`
          : `${repo.fullName} is already up to date.`,
        'success'
      );
    } catch (error) {
      showToast(
        parseFriendlyFirestoreError(error, `Couldn't check ${repo.fullName} for updates. Please try again.`),
        'error'
      );
    }
  };

  return (
    <AppShell
      title="Projects"
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Projects' }]}
      subtitle="The GitHub projects BuildLog is keeping track of for you."
      actions={
        <Link to="/integrations" className={getButtonClasses('primary', 'sm')}>
          <Plug className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Add a project</span>
        </Link>
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-52 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse"
            />
          ))}
        </div>
      ) : repositories.length === 0 ? (
        <EmptyState
          icon={<GitBranch className="w-5 h-5" />}
          title="No projects yet"
          description="Add a project by pasting its GitHub link. BuildLog will copy its recent work and keep track of new changes for you."
          actionLabel="Add a project"
          onAction={() => navigate('/integrations')}
        />
      ) : (
        <div className="space-y-6">
          {/* Telemetry Summary Strip */}
          <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <p className="text-xs text-[#B8F34A]">
                {countsByStatus.active} active{' '}
                {countsByStatus.active === 1 ? 'project' : 'projects'}
              </p>
              <p className="mt-1 text-sm text-[#929B90]">
                New changes on GitHub are added automatically.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-6 shrink-0 border-t md:border-t-0 md:border-l border-[#252D24] pt-3 md:pt-0 md:pl-6">
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#929B90]">
                  Updates
                </p>
                <p className="mt-0.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                  {activityEvents.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#929B90]">
                  Recaps
                </p>
                <p className="mt-0.5 text-xl font-display font-bold tabular-nums text-[#B8F34A]">
                  {activitySummaries.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-[#929B90]">
                  Projects
                </p>
                <p className="mt-0.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                  {repositories.length}
                </p>
              </div>
            </div>
          </section>

          {/* Search, Filter Tabs, and Grid/List Toggle */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search
                className="w-4 h-4 text-[#929B90] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a project…"
                aria-label="Find a project"
                className="min-h-[40px] w-full rounded-lg border border-[#252D24] bg-[#121512] pl-10 pr-12 py-2 text-sm text-[#F3F5EF] placeholder:text-[#929B90]/60 focus:outline-none focus:border-[#B8F34A]"
              />
              <kbd className="hidden sm:inline-block absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[#929B90] bg-[#181B18] border border-[#252D24] rounded px-1.5 py-0.5 pointer-events-none">
                ⌘F
              </kbd>
            </div>

            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['all', 'active', 'paused', 'disconnected'] as const).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatusFilter(status)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                      statusFilter === status
                        ? 'bg-[#181B18] text-[#B8F34A] border-[#B8F34A]/40'
                        : 'bg-[#121512] text-[#929B90] border-[#252D24] hover:text-[#FCFFEC]'
                    }`}
                  >
                    {status === 'all'
                      ? `All (${countsByStatus.all})`
                      : `${status.charAt(0).toUpperCase() + status.slice(1)} (${
                          countsByStatus[status]
                        })`}
                  </button>
                ))}
              </div>

              <div
                className="flex items-center gap-1 p-0.5 rounded-lg bg-[#121512] border border-[#252D24] shrink-0"
                role="group"
                aria-label="View layout"
              >
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Grid view"
                  aria-pressed={viewMode === 'grid'}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    viewMode === 'grid'
                      ? 'bg-[#181B18] text-[#B8F34A]'
                      : 'text-[#929B90] hover:text-[#FCFFEC]'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="List view"
                  aria-pressed={viewMode === 'list'}
                  className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                    viewMode === 'list'
                      ? 'bg-[#181B18] text-[#B8F34A]'
                      : 'text-[#929B90] hover:text-[#FCFFEC]'
                  }`}
                >
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {filteredRepos.length === 0 ? (
            <EmptyState
              icon={<Search className="w-5 h-5" />}
              title="No matching projects"
              description="Try a different search, or clear the filter."
            />
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {filteredRepos.map((repo) => {
                const eventCount = activityEvents.filter(
                  (e) => e.repositoryId === repo.id
                ).length;
                const summaryCount = activitySummaries.filter(
                  (s) => s.repositoryId === repo.id
                ).length;

                return (
                  <article
                    key={repo.id}
                    className="rounded-2xl border border-[#252D24] bg-[#121512] hover:border-[#394637] transition-colors p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <Link
                            to={`/projects/${repo.id}`}
                            className="text-base font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] transition-colors truncate block"
                          >
                            {repo.fullName}
                          </Link>
                          <p className="mt-0.5 text-xs text-[#929B90] font-mono truncate">
                            {repo.primaryLanguage || 'Repository'} · {repo.defaultBranch}
                          </p>
                        </div>
                        <RepositoryStatusLabel status={repo.status} />
                      </div>

                      <p className="text-sm text-[#929B90] line-clamp-2 min-h-[2.5rem]">
                        {repo.objective ||
                          repo.description ||
                          'No description yet.'}
                      </p>

                      {/* Clean 3-column metrics */}
                      <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#252D24] bg-[#080908] px-3 py-2.5">
                        <div>
                          <p className="text-[10px] uppercase text-[#929B90]">Updates</p>
                          <p className="text-sm font-display font-bold tabular-nums text-[#FCFFEC]">
                            {eventCount}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-[#929B90]">Recaps</p>
                          <p className="text-sm font-display font-bold tabular-nums text-[#B8F34A]">
                            {summaryCount}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase text-[#929B90]">Updated</p>
                          <p className="text-xs font-mono tabular-nums text-[#F3F5EF] truncate mt-0.5">
                            {repo.lastSyncedAt
                              ? formatRelativeDate(repo.lastSyncedAt)
                              : 'Never'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-[#252D24] flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={syncingRepoId === repo.id}
                          disabled={repo.status !== 'active'}
                          icon={<RefreshCw className="w-3.5 h-3.5" />}
                          onClick={() => void handleSync(repo.id)}
                        >
                          Check for updates
                        </Button>
                        <Link
                          to={`/projects/${repo.id}/memory`}
                          className={getButtonClasses('primary', 'sm')}
                        >
                          <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>Summary</span>
                        </Link>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Link
                          to={`/projects/${repo.id}`}
                          aria-label={`View details for ${repo.fullName}`}
                          className={getButtonClasses('ghost', 'sm')}
                        >
                          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </Link>
                        {repo.htmlUrl && (
                          <a
                            href={repo.htmlUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open ${repo.fullName} on GitHub`}
                            className={getButtonClasses('ghost', 'sm')}
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] divide-y divide-[#252D24]">
              {filteredRepos.map((repo) => {
                const eventCount = activityEvents.filter(
                  (e) => e.repositoryId === repo.id
                ).length;
                const summaryCount = activitySummaries.filter(
                  (s) => s.repositoryId === repo.id
                ).length;

                return (
                  <div
                    key={repo.id}
                    className="p-4 sm:px-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#181B18]/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-3">
                        <Link
                          to={`/projects/${repo.id}`}
                          className="text-sm font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] truncate"
                        >
                          {repo.fullName}
                        </Link>
                        <RepositoryStatusLabel status={repo.status} />
                      </div>
                      <p className="text-xs text-[#929B90] tabular-nums">
                        {eventCount} {eventCount === 1 ? 'update' : 'updates'} · {summaryCount}{' '}
                        {summaryCount === 1 ? 'recap' : 'recaps'} ·{' '}
                        {repo.lastSyncedAt
                          ? `Updated ${formatRelativeDate(repo.lastSyncedAt)}`
                          : 'Not updated yet'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={syncingRepoId === repo.id}
                        disabled={repo.status !== 'active'}
                        icon={<RefreshCw className="w-3.5 h-3.5" />}
                        onClick={() => void handleSync(repo.id)}
                      >
                        Check for updates
                      </Button>
                      <Link
                        to={`/projects/${repo.id}/memory`}
                        className={getButtonClasses('primary', 'sm')}
                      >
                        <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Summary</span>
                      </Link>
                      {repo.htmlUrl && (
                        <a
                          href={repo.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${repo.fullName} on GitHub`}
                          className={getButtonClasses('ghost', 'sm')}
                        >
                          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Connect Another Repository Banner */}
          <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[#252D24] bg-[#181B18] text-[#B8F34A] shrink-0">
                <Plug className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-display font-semibold text-[#FCFFEC]">
                  Add another project
                </h2>
                <p className="mt-0.5 text-xs text-[#929B90]">
                  Paste another GitHub link and BuildLog will start tracking it too.
                </p>
              </div>
            </div>

            <Link to="/integrations" className={getButtonClasses('secondary', 'sm')}>
              <GitBranch className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Add a project</span>
            </Link>
          </section>
        </div>
      )}
    </AppShell>
  );
}
