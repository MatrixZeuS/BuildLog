import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button, getButtonClasses } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Textarea } from '../components/ui/FormFields';
import {
  EventTypeLabel,
  ProcessingStatusLabel,
  RepositoryStatusLabel,
} from '../components/ui/StatusLabel';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import { updateRepositoryObjective, updateRepositoryStatus } from '../services/dbService';
import { parseFriendlyFirestoreError } from '../lib/firebase';
import { formatRelativeDate, formatShortDate } from '../utils/dateUtils';
import { validateObjective, SCHEMA_LIMITS } from '../utils/validation';
import { synthesizeProjectMemoryFromHistory } from '../utils/projectMemoryBuilder';

export function RepositoryDetailPage() {
  const { repositoryId } = useParams<{ repositoryId: string }>();
  const navigate = useNavigate();
  const {
    repositories,
    activityEvents,
    activitySummaries,
    projectMemory,
    loading,
    syncingRepoId,
    summarizingRepoId,
    syncRepositoryHistory,
    summarizeRepositoryPendingEvents,
    refreshProjectMemory,
  } = useWorkspace();
  const { showToast } = useToast();

  const repository = useMemo(
    () => repositories.find((r) => r.id === repositoryId) ?? null,
    [repositories, repositoryId]
  );

  const repoEvents = useMemo(
    () =>
      activityEvents
        .filter((e) => e.repositoryId === repositoryId)
        .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()),
    [activityEvents, repositoryId]
  );

  const repoSummaries = useMemo(
    () =>
      activitySummaries
        .filter((s) => s.repositoryId === repositoryId)
        .sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()),
    [activitySummaries, repositoryId]
  );

  const storedMemory = useMemo(
    () => projectMemory.find((m) => m.repositoryId === repositoryId) ?? null,
    [projectMemory, repositoryId]
  );

  const synthesized = useMemo(() => {
    if (!repository) return null;
    return synthesizeProjectMemoryFromHistory(
      repository,
      repoEvents,
      repoSummaries,
      storedMemory
    );
  }, [repository, repoEvents, repoSummaries, storedMemory]);

  const [objective, setObjective] = useState('');
  const [objectiveError, setObjectiveError] = useState<string | undefined>();
  const [savingObjective, setSavingObjective] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  useEffect(() => {
    setObjective(repository?.objective ?? '');
  }, [repository?.id, repository?.objective]);

  if (!loading && !repository) {
    return (
      <AppShell
        title="Project not found"
        breadcrumbs={[
          { label: 'Projects', to: '/projects' },
          { label: 'Not found' },
        ]}
      >
        <EmptyState
          icon={<GitBranch className="w-5 h-5" />}
          title="We can't find this project"
          description="It may have been disconnected or removed."
          actionLabel="Back to projects"
          onAction={() => navigate('/projects')}
        />
      </AppShell>
    );
  }

  const handleSaveObjective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repository) return;
    const err = validateObjective(objective);
    if (err) {
      setObjectiveError(err);
      return;
    }
    setObjectiveError(undefined);
    setSavingObjective(true);
    try {
      await updateRepositoryObjective(repository.id, objective);
      await refreshProjectMemory({ ...repository, objective: objective.trim() });
      showToast('Goal saved. Your project summary has been updated.', 'success');
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, "Couldn't save the goal. Please try again."), 'error');
    } finally {
      setSavingObjective(false);
    }
  };

  const handleTogglePause = async () => {
    if (!repository) return;
    const nextStatus = repository.status === 'active' ? 'paused' : 'active';
    setUpdatingStatus(true);
    try {
      await updateRepositoryStatus(repository.id, nextStatus);
      showToast(
        nextStatus === 'paused'
          ? `Paused. BuildLog won't record new changes for ${repository.fullName} until you resume.`
          : `Resumed. New changes for ${repository.fullName} will be recorded again.`,
        'info'
      );
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, "Couldn't change this setting. Please try again."), 'error');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleSync = async () => {
    if (!repository) return;
    try {
      const result = await syncRepositoryHistory(repository);
      showToast(
        result.insertedCount > 0
          ? `Found ${result.insertedCount} new ${result.insertedCount === 1 ? 'update' : 'updates'}.`
          : 'Already up to date.',
        'success'
      );
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, "Couldn't check for updates. Please try again."), 'error');
    }
  };

  const handleSummarize = async () => {
    if (!repository) return;
    try {
      const res = await summarizeRepositoryPendingEvents(repository);
      if (res.status === 'ready') {
        showToast(`Created a recap of ${res.summarizedCount} ${res.summarizedCount === 1 ? 'update' : 'updates'}.`, 'success');
      } else {
        showToast(res.message || "AI recaps aren't available right now. Your updates are still saved.", 'info');
      }
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, "Couldn't create a recap. Please try again."), 'error');
    }
  };

  const pendingCount = repoEvents.filter(
    (e) =>
      e.processingStatus === 'pending' ||
      e.processingStatus === 'recorded_without_summary' ||
      e.processingStatus === 'failed'
  ).length;

  return (
    <AppShell
      title={repository?.fullName ?? 'Loading…'}
      subtitle={repository?.description || 'Recent work on this project.'}
      breadcrumbs={[
        { label: 'Projects', to: '/projects' },
        { label: repository?.fullName ?? 'Project' },
      ]}
      actions={
        repository && (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={syncingRepoId === repository.id}
              disabled={repository.status !== 'active'}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void handleSync()}
            >
              Check for updates
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={summarizingRepoId === repository.id}
              disabled={pendingCount === 0}
              icon={<Sparkles className="w-3.5 h-3.5" />}
              onClick={() => void handleSummarize()}
            >
              Create AI recap{pendingCount > 0 ? ` (${pendingCount})` : ''}
            </Button>
            <Link
              to={`/projects/${repository.id}/memory`}
              className={getButtonClasses('primary', 'sm')}
            >
              <FileCode2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Project summary</span>
            </Link>
          </>
        )
      }
    >
      {loading || !repository || !synthesized ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-24 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse"
              />
            ))}
          </div>
          <div className="h-64 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Vital Signs KPI Strip */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Updates</span>
                <GitCommit className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {repoEvents.length}
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Waiting for review</span>
                <GitPullRequest className="w-4 h-4 text-emerald-300" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.openPullRequests.length}
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Open problems</span>
                <AlertCircle className="w-4 h-4 text-amber-300" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.openIssues.length}
              </p>
            </div>

            <div className="rounded-2xl border border-[#252D24] bg-[#121512] p-4">
              <div className="flex items-center justify-between text-xs text-[#929B90]">
                <span>Parts changed</span>
                <FolderGit2 className="w-4 h-4 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-2 text-2xl font-display font-bold tabular-nums text-[#B8F34A]">
                {synthesized.modifiedCodeAreas.length}
              </p>
            </div>
          </section>

          {/* Tracking Metadata + Objective Form */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-5 rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                  Tracking
                </h2>
                <RepositoryStatusLabel status={repository.status} />
              </div>

              <dl className="divide-y divide-[#252D24] text-sm">
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">Main language</dt>
                  <dd className="text-[#FCFFEC]">{repository.primaryLanguage || '—'}</dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">Last updated</dt>
                  <dd className="tabular-nums text-[#FCFFEC]">
                    {repository.lastSyncedAt ? formatShortDate(repository.lastSyncedAt) : 'Not yet'}
                  </dd>
                </div>
                <div className="py-2.5 flex items-center justify-between gap-4">
                  <dt className="text-[#929B90]">AI recaps</dt>
                  <dd className="tabular-nums text-xs text-[#B8F34A]">
                    {repoSummaries.length}
                  </dd>
                </div>
              </dl>

              <div className="pt-2 flex flex-wrap items-center gap-2">
                {repository.status !== 'disconnected' && (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={updatingStatus}
                    icon={
                      repository.status === 'active' ? (
                        <PauseCircle className="w-3.5 h-3.5" />
                      ) : (
                        <PlayCircle className="w-3.5 h-3.5" />
                      )
                    }
                    onClick={() => void handleTogglePause()}
                  >
                    {repository.status === 'active' ? 'Pause tracking' : 'Resume tracking'}
                  </Button>
                )}
                {repository.htmlUrl && (
                  <a
                    href={repository.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={getButtonClasses('ghost', 'sm')}
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>Open on GitHub</span>
                  </a>
                )}
              </div>
            </div>

            <form
              onSubmit={handleSaveObjective}
              className="lg:col-span-7 rounded-2xl border border-[#252D24] bg-[#121512] p-5 flex flex-col justify-between gap-4"
              noValidate
            >
              <div>
                <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                  Project goal (optional)
                </h2>
                <p className="mt-1 text-xs text-[#929B90]">
                  In a sentence, what is this project trying to achieve? It's shown at the top of your project summary.
                </p>
                <div className="mt-4">
                  <Textarea
                    label="Goal"
                    rows={3}
                    maxLength={SCHEMA_LIMITS.REPO_OBJECTIVE_MAX}
                    value={objective}
                    onChange={(e) => setObjective(e.target.value)}
                    placeholder="e.g. Launch the online shop so customers can order from their phones."
                    error={objectiveError}
                  />
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  loading={savingObjective}
                  icon={<Save className="w-3.5 h-3.5" />}
                >
                  Save goal
                </Button>
              </div>
            </form>
          </section>

          {/* Modified Code Areas & Open PR/Issue Radar */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Parts of the project that changed
              </h2>
              <p className="text-xs text-[#929B90]">
                The folders where most recent work happened.
              </p>
              {synthesized.modifiedCodeAreas.length > 0 ? (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs font-mono">
                  {synthesized.modifiedCodeAreas.slice(0, 10).map((area, idx) => (
                    <li
                      key={idx}
                      className="rounded-lg border border-[#252D24] bg-[#080908] px-3 py-2 text-[#B8F34A] truncate"
                    >
                      {area}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#929B90] pt-1">
                  Nothing yet.
                </p>
              )}
            </div>

            <div className="lg:col-span-6 rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Still open
              </h2>

              <div className="space-y-3 text-xs">
                <div>
                  <p className="text-emerald-300 mb-1.5">
                    Waiting for review: pull requests ({synthesized.openPullRequests.length})
                  </p>
                  {synthesized.openPullRequests.length > 0 ? (
                    <ul className="space-y-1 text-[#F3F5EF]">
                      {synthesized.openPullRequests.slice(0, 5).map((pr, i) => (
                        <li key={i} className="truncate">• {pr}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[#929B90]">None right now.</p>
                  )}
                </div>

                <div className="pt-3 border-t border-[#252D24]">
                  <p className="text-amber-300 mb-1.5">
                    Open problems: issues ({synthesized.openIssues.length})
                  </p>
                  {synthesized.openIssues.length > 0 ? (
                    <ul className="space-y-1 text-[#F3F5EF]">
                      {synthesized.openIssues.slice(0, 5).map((iss, i) => (
                        <li key={i} className="truncate">• {iss}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[#929B90]">None right now.</p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Automated Activity Summaries */}
          <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
            <div>
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                AI recaps
              </h2>
              <p className="mt-0.5 text-xs text-[#929B90]">
                Short recaps of recent work. Facts from GitHub are always shown separately from guesses and suggestions.
              </p>
            </div>

            {repoSummaries.length === 0 ? (
              <div className="rounded-xl border border-[#252D24] bg-[#080908] p-4 text-xs text-[#929B90]">
                No recaps yet. Your updates are saved below. Click &ldquo;Create AI recap&rdquo; to make one.
              </div>
            ) : (
              <div className="space-y-4">
                {repoSummaries.slice(0, 5).map((sum) => (
                  <article
                    key={sum.id}
                    className="rounded-xl border border-[#252D24] bg-[#080908] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-[#929B90]">
                      <span className="tabular-nums">
                        Covers {sum.relatedEventIds.length}{' '}
                        {sum.relatedEventIds.length === 1 ? 'update' : 'updates'}
                      </span>
                      <span className="tabular-nums">{formatShortDate(sum.generatedAt)}</span>
                    </div>

                    <p className="text-sm text-[#FCFFEC] leading-relaxed">{sum.summary}</p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-3 border-t border-[#252D24] text-xs">
                      <div>
                        <p className="text-[#B8F34A] mb-1.5">Facts from GitHub</p>
                        {sum.evidence.length > 0 ? (
                          <ul className="space-y-1 text-[#F3F5EF]/90 list-disc list-inside">
                            {sum.evidence.map((ev, i) => (
                              <li key={i}>{ev}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[#929B90]">None listed.</p>
                        )}
                      </div>

                      <div>
                        <p className="text-amber-300 mb-1.5">Our best guesses</p>
                        {sum.inferences.length > 0 ? (
                          <ul className="space-y-1 text-[#929B90] list-disc list-inside">
                            {sum.inferences.map((inf, i) => (
                              <li key={i}>{inf}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[#929B90]">None.</p>
                        )}
                      </div>

                      <div>
                        <p className="text-[#FCFFEC] mb-1.5">Suggested next steps</p>
                        {sum.suggestedNextSteps.length > 0 ? (
                          <ul className="space-y-1 text-[#929B90] list-disc list-inside">
                            {sum.suggestedNextSteps.map((step, i) => (
                              <li key={i}>{step}</li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[#929B90]">None suggested.</p>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Raw Ingested GitHub Activity Events */}
          <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-4">
            <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
              All updates
            </h2>

            {repoEvents.length === 0 ? (
              <p className="text-sm text-[#929B90]">
                No updates yet. Click &ldquo;Check for updates&rdquo; above, or make a change on GitHub.
              </p>
            ) : (
              <ul className="divide-y divide-[#252D24]">
                {repoEvents.slice(0, 30).map((ev) => (
                  <li key={ev.id} className="py-3.5 first:pt-0 last:pb-0 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <EventTypeLabel eventType={ev.eventType} />
                        {ev.author && (
                          <span className="text-xs text-[#929B90]">by {ev.author}</span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <ProcessingStatusLabel status={ev.processingStatus} />
                        <span className="text-xs text-[#929B90] tabular-nums">
                          {formatRelativeDate(ev.occurredAt)}
                        </span>
                        {ev.sourceUrl && (
                          <a
                            href={ev.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`View on GitHub: ${ev.title}`}
                            className="text-[#929B90] hover:text-[#B8F34A]"
                          >
                            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                        )}
                      </div>
                    </div>

                    <p className="text-sm font-medium text-[#FCFFEC]">{ev.title}</p>

                    {ev.changedFiles.length > 0 && (
                      <p className="text-xs text-[#929B90] break-all">
                        Files changed: {ev.changedFiles.slice(0, 5).join(', ')}
                        {ev.changedFiles.length > 5
                          ? ` and ${ev.changedFiles.length - 5} more`
                          : ''}
                      </p>
                    )}

                    {ev.errorMessage && (
                      <p className="text-xs text-amber-300 flex items-center gap-1.5">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>{ev.errorMessage}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AppShell>
  );
}
