import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Plug,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { WebhookHealthCard } from '../components/integrations/WebhookHealthCard';
import { Button, getButtonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import {
  EventTypeLabel,
  ProcessingStatusLabel,
  RepositoryStatusLabel,
} from '../components/ui/StatusLabel';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { computeDashboardMetrics } from '../utils/dashboardStats';
import { formatRelativeDate, formatShortDate } from '../utils/dateUtils';
import {
  buildAutomatedResumeMarkdown,
  synthesizeProjectMemoryFromHistory,
} from '../utils/projectMemoryBuilder';

export function DashboardPage() {
  const { user, userProfile } = useAuth();
  const {
    repositories,
    activityEvents,
    activitySummaries,
    projectMemory,
    loading,
    error,
  } = useWorkspace();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [copiedRepoId, setCopiedRepoId] = useState<string | null>(null);

  const metrics = useMemo(
    () =>
      computeDashboardMetrics(
        repositories,
        activityEvents,
        activitySummaries,
        projectMemory
      ),
    [repositories, activityEvents, activitySummaries, projectMemory]
  );

  const maxDailyTotal = Math.max(
    1,
    ...metrics.weeklyActivity.map((d) => d.totalCount)
  );

  const displayName =
    userProfile?.displayName ||
    user?.displayName ||
    user?.email?.split('@')[0] ||
    'there';

  const repoMap = useMemo(
    () => new Map(repositories.map((r) => [r.id, r])),
    [repositories]
  );

  const handleCopyRepoContext = async (repositoryId: string) => {
    const repo = repoMap.get(repositoryId);
    if (!repo) return;
    const repoEvents = activityEvents.filter((e) => e.repositoryId === repo.id);
    const repoSummaries = activitySummaries.filter((s) => s.repositoryId === repo.id);
    const existing = projectMemory.find((m) => m.repositoryId === repo.id) ?? null;
    const synthesized = synthesizeProjectMemoryFromHistory(
      repo,
      repoEvents,
      repoSummaries,
      existing
    );
    const report = buildAutomatedResumeMarkdown(
      repo,
      synthesized,
      repoEvents,
      repoSummaries,
      existing?.lastUpdatedAt ?? new Date()
    );

    try {
      await navigator.clipboard.writeText(report.markdown);
      setCopiedRepoId(repo.id);
      showToast(`Copied the summary for ${repo.fullName}.`, 'success');
      window.setTimeout(() => setCopiedRepoId(null), 2000);
    } catch {
      showToast("Couldn't copy. Your browser blocked access to the clipboard.", 'error');
    }
  };

  return (
    <AppShell
      title="Overview"
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Overview' }]}
      subtitle="What's been happening across your projects."
    >
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-500/40 bg-red-950/30 px-4 py-3 text-sm text-red-200"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-6">
          <div className="h-32 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse"
              />
            ))}
          </div>
        </div>
      ) : repositories.length === 0 ? (
        <div className="space-y-6">
          <WebhookHealthCard variant="dashboard" />
          <EmptyState
            icon={<Plug className="w-5 h-5" />}
            title="Add your first project"
            description="Paste a link to a project on GitHub. BuildLog will copy your recent work and keep track of new changes automatically. It can only read your project, never change it."
            actionLabel="Add a project"
            onAction={() => navigate('/integrations')}
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Welcome Telemetry Banner */}
          <section className="relative overflow-hidden rounded-2xl border border-[#252D24] bg-[#121512] p-6">
            <div
              className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-[#B8F34A]/[0.07] blur-[90px]"
              aria-hidden="true"
            />
            <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-5">
              <div className="space-y-1.5">
                <p className="text-xs text-[#B8F34A]">
                  Welcome back, {displayName}
                </p>
                <h2 className="text-xl sm:text-2xl font-display font-bold tracking-tight text-[#FCFFEC]">
                  Tracking {metrics.activeReposCount}{' '}
                  {metrics.activeReposCount === 1 ? 'project' : 'projects'} for you
                </h2>
                <p className="text-sm text-[#929B90]">
                  {metrics.totalEventsCount} {metrics.totalEventsCount === 1 ? 'update' : 'updates'} recorded so far.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <Link to="/projects" className={getButtonClasses('secondary', 'md')}>
                  <GitBranch className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>All projects</span>
                </Link>
                <Link to="/memory" className={getButtonClasses('primary', 'md')}>
                  <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Catch up</span>
                </Link>
              </div>
            </div>
          </section>

          {/* Real-Time Webhook Connectivity Health & Last Synced */}
          <WebhookHealthCard variant="dashboard" />

          {/* 4-Card Metric Quad */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Projects</span>
                <GitBranch className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.activeReposCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90]">
                being tracked
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Updates this week</span>
                <Activity className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.eventsThisWeekCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90] tabular-nums">
                {metrics.totalEventsCount} in total
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>AI recaps</span>
                <Sparkles className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.aiSummariesCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90] tabular-nums">
                {metrics.pendingEventsCount} updates not summarized yet
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Still open</span>
                <GitPullRequest className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2.5 text-3xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {metrics.openPullRequestsCount + metrics.openIssuesCount}
              </p>
              <p className="mt-1 text-xs text-[#929B90] tabular-nums">
                {metrics.openPullRequestsCount} waiting for review · {metrics.openIssuesCount} problems
              </p>
            </div>
          </section>

          {/* Main Asymmetric 8/4 Workspace Grid */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left 8 Columns: Summaries, Inferred Clusters, and Events */}
            <div className="lg:col-span-8 space-y-6">
              {/* Recent Activity Summaries */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6 space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                      Latest recaps
                    </h2>
                    <p className="mt-0.5 text-xs text-[#929B90]">
                      Short summaries of recent work, ready to read or share.
                    </p>
                  </div>
                  <Link
                    to="/memory"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    All summaries
                  </Link>
                </div>

                {activitySummaries.length === 0 ? (
                  <div className="rounded-xl border border-[#252D24] bg-[#080908] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-xs text-[#929B90] leading-relaxed">
                      No recaps yet. Your updates are saved. Open the Timeline to create a recap.
                    </p>
                    <Link to="/timeline" className={getButtonClasses('secondary', 'sm')}>
                      Open timeline
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activitySummaries.slice(0, 3).map((summary) => {
                      const repo = repoMap.get(summary.repositoryId);
                      const isCopied = copiedRepoId === summary.repositoryId;
                      return (
                        <article
                          key={summary.id}
                          className="rounded-xl border border-[#252D24] bg-[#080908] p-4 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <Sparkles className="w-3.5 h-3.5 text-[#B8F34A] shrink-0" aria-hidden="true" />
                              <Link
                                to={repo ? `/projects/${repo.id}` : '/projects'}
                                className="text-sm font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] truncate"
                              >
                                {repo?.fullName ?? 'Project'}
                              </Link>
                            </div>
                            <span className="text-xs font-mono tabular-nums text-[#929B90] shrink-0">
                              {formatShortDate(summary.generatedAt)}
                            </span>
                          </div>

                          <p className="text-sm text-[#F3F5EF]/90 leading-relaxed">
                            {summary.summary}
                          </p>

                          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#252D24]">
                            <span className="text-xs text-[#929B90] tabular-nums">
                              {summary.evidence.length} facts ·{' '}
                              {summary.suggestedNextSteps.length} suggested next steps
                            </span>

                            {repo && (
                              <div className="flex items-center gap-2 shrink-0">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  icon={
                                    isCopied ? (
                                      <Check className="w-3.5 h-3.5 text-[#B8F34A]" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )
                                  }
                                  onClick={() => void handleCopyRepoContext(repo.id)}
                                >
                                  {isCopied ? 'Copied' : 'Copy summary'}
                                </Button>
                                <Link
                                  to={`/projects/${repo.id}/memory`}
                                  className={getButtonClasses('ghost', 'sm')}
                                >
                                  <span>Summary</span>
                                  <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                </Link>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Inferred Activity Clusters */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                      Work sessions
                    </h2>
                    <p className="mt-0.5 text-xs text-[#929B90]">
                      Changes made close together, grouped for easy reading. These are estimates, not hours worked.
                    </p>
                  </div>
                  <Link
                    to="/timeline"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    Open timeline
                  </Link>
                </div>

                {metrics.recentClusters.length === 0 ? (
                  <p className="mt-5 text-sm text-[#929B90]">
                    Nothing yet. Work sessions appear once your projects have some changes.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-[#252D24]">
                    {metrics.recentClusters.map((cluster) => (
                      <li key={cluster.clusterId} className="py-3.5 first:pt-0 last:pb-0">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              to={`/projects/${cluster.repositoryId}`}
                              className="text-sm font-medium text-[#FCFFEC] hover:text-[#B8F34A] transition-colors truncate block"
                            >
                              {cluster.repositoryName} — {cluster.label}
                            </Link>
                            <p className="mt-0.5 text-xs text-[#929B90] truncate">
                              {cluster.changedFiles.length}{' '}
                              {cluster.changedFiles.length === 1 ? 'file' : 'files'} changed
                            </p>
                          </div>
                          <span className="text-xs font-mono tabular-nums text-[#929B90] whitespace-nowrap shrink-0">
                            {formatRelativeDate(cluster.endAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Recent GitHub Events Stream */}
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Latest updates
                  </h2>
                  <Link
                    to="/timeline"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    Full timeline
                  </Link>
                </div>

                {metrics.recentEvents.length === 0 ? (
                  <p className="mt-4 text-sm text-[#929B90]">
                    No updates yet. They'll appear here as soon as something changes on GitHub.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-[#252D24]">
                    {metrics.recentEvents.map((ev) => (
                      <li key={ev.id} className="py-3 first:pt-0 last:pb-0 space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <EventTypeLabel eventType={ev.eventType} />
                            <span className="text-xs text-[#929B90] truncate">
                              {ev.repositoryName}
                            </span>
                          </div>
                          <ProcessingStatusLabel status={ev.processingStatus} />
                        </div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-[#FCFFEC] truncate">{ev.title}</p>
                          <div className="flex items-center gap-2.5 shrink-0">
                            <span className="text-xs font-mono text-[#929B90] tabular-nums">
                              {formatRelativeDate(ev.occurredAt)}
                            </span>
                            {ev.sourceUrl && (
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open event on GitHub: ${ev.title}`}
                                className="text-[#929B90] hover:text-[#B8F34A]"
                              >
                                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                              </a>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Right 4 Columns: 7-Day Activity Pulse + Active Projects */}
            <div className="lg:col-span-4 space-y-6">
              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex flex-col justify-between">
                <div>
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Last 7 days
                  </h2>
                  <p className="mt-0.5 text-xs text-[#929B90]">
                    Number of updates each day.
                  </p>
                </div>

                <div className="mt-6 grid grid-cols-7 gap-2 items-end h-36">
                  {metrics.weeklyActivity.map((day) => {
                    const pct = Math.round((day.totalCount / maxDailyTotal) * 100);
                    return (
                      <div
                        key={day.dateKey}
                        className="flex flex-col items-center justify-end h-full gap-1.5"
                      >
                        <span className="text-[11px] font-mono tabular-nums text-[#929B90]">
                          {day.totalCount}
                        </span>
                        <div className="w-full max-w-[26px] h-24 rounded-md bg-[#080908] border border-[#252D24] flex items-end overflow-hidden">
                          <div
                            className="w-full bg-[#B8F34A] transition-all duration-200"
                            style={{ height: `${day.totalCount > 0 ? Math.max(12, pct) : 0}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-[#929B90]">{day.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Your projects
                  </h2>
                  <Link
                    to="/projects"
                    className="text-xs font-medium text-[#B8F34A] hover:underline whitespace-nowrap shrink-0"
                  >
                    View all
                  </Link>
                </div>

                <ul className="space-y-2.5">
                  {repositories.slice(0, 6).map((repo) => (
                    <li
                      key={repo.id}
                      className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/projects/${repo.id}`}
                          className="text-sm font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] truncate block min-w-0"
                        >
                          {repo.fullName}
                        </Link>
                        <RepositoryStatusLabel status={repo.status} />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-[#929B90]">
                        <span className="truncate">
                          {repo.primaryLanguage || 'Project'}
                        </span>
                        <Link
                          to={`/projects/${repo.id}/memory`}
                          className="text-[#B8F34A] hover:underline whitespace-nowrap shrink-0 font-medium"
                        >
                          Summary →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
