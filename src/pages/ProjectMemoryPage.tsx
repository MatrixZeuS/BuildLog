import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  FolderGit2,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  buildAutomatedResumeMarkdown,
  synthesizeProjectMemoryFromHistory,
} from '../utils/projectMemoryBuilder';
import { downloadTextFile, slugifyFilename } from '../utils/exportData';
import { formatShortDate } from '../utils/dateUtils';
import { parseFriendlyFirestoreError } from '../lib/firebase';

export function ProjectMemoryPage() {
  const { repositoryId } = useParams<{ repositoryId?: string }>();
  const navigate = useNavigate();
  const {
    repositories,
    activityEvents,
    activitySummaries,
    projectMemory,
    loading,
    refreshProjectMemory,
  } = useWorkspace();
  const { showToast } = useToast();

  const activeRepository = useMemo(() => {
    if (repositoryId) {
      return repositories.find((r) => r.id === repositoryId) ?? null;
    }
    return repositories[0] ?? null;
  }, [repositories, repositoryId]);

  const [viewMode, setViewMode] = useState<'structured' | 'markdown' | 'prompt'>('structured');
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const repoEvents = useMemo(
    () =>
      activeRepository
        ? activityEvents.filter((e) => e.repositoryId === activeRepository.id)
        : [],
    [activityEvents, activeRepository]
  );

  const repoSummaries = useMemo(
    () =>
      activeRepository
        ? activitySummaries.filter((s) => s.repositoryId === activeRepository.id)
        : [],
    [activitySummaries, activeRepository]
  );

  const storedMemory = useMemo(
    () =>
      activeRepository
        ? projectMemory.find((m) => m.repositoryId === activeRepository.id) ?? null
        : null,
    [projectMemory, activeRepository]
  );

  const synthesized = useMemo(() => {
    if (!activeRepository) return null;
    return synthesizeProjectMemoryFromHistory(
      activeRepository,
      repoEvents,
      repoSummaries,
      storedMemory
    );
  }, [activeRepository, repoEvents, repoSummaries, storedMemory]);

  const resumeReport = useMemo(() => {
    if (!activeRepository || !synthesized) return null;
    return buildAutomatedResumeMarkdown(
      activeRepository,
      synthesized,
      repoEvents,
      repoSummaries,
      storedMemory?.lastUpdatedAt ?? new Date()
    );
  }, [activeRepository, synthesized, repoEvents, repoSummaries, storedMemory]);

  const codingPromptPayload = useMemo(() => {
    if (!activeRepository || !resumeReport) return '';
    return `You are resuming work on the repository "${activeRepository.fullName}". Use only the verified GitHub evidence, modified code areas, and open pull requests/issues below—do not assume unrecorded changes.\n\n${resumeReport.markdown}`;
  }, [activeRepository, resumeReport]);

  const activeCopyText =
    viewMode === 'prompt' ? codingPromptPayload : resumeReport?.markdown ?? '';

  const handleCopyContext = useCallback(async () => {
    if (!activeCopyText) return;
    try {
      await navigator.clipboard.writeText(activeCopyText);
      setCopied(true);
      showToast(
        viewMode === 'prompt'
          ? 'Copied. Paste it into your AI assistant.'
          : 'Summary copied.',
        'success'
      );
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Couldn't copy. Your browser blocked access to the clipboard.", 'error');
    }
  }, [activeCopyText, showToast, viewMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (!isInput && e.altKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        void handleCopyContext();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCopyContext]);

  const handleExportMarkdown = () => {
    if (!activeRepository || !resumeReport) return;
    const filename = `${slugifyFilename(activeRepository.fullName)}-resume-context.md`;
    downloadTextFile(filename, resumeReport.markdown, 'text/markdown;charset=utf-8');
    showToast(`Downloaded ${filename}`, 'success');
  };

  const handleRefreshMemory = async () => {
    if (!activeRepository) return;
    setRefreshing(true);
    try {
      await refreshProjectMemory(activeRepository);
      showToast(`Summary updated for ${activeRepository.fullName}.`, 'success');
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, "Couldn't update the summary. Please try again."), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const bottomActionBar =
    activeRepository && resumeReport ? (
      <div className="hidden md:flex sticky bottom-0 z-20 border-t border-[#252D24] bg-[#0D0F0D]/95 backdrop-blur-md px-8 py-3 items-center justify-between gap-6">
        <div className="flex items-center gap-4 text-xs text-[#929B90] min-w-0">
          <span className="truncate">
            {viewMode === 'prompt'
              ? 'Copying: version for AI assistants'
              : 'Copying: project summary'}
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handleExportMarkdown}
          >
            Download
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            onClick={() => void handleCopyContext()}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    ) : undefined;

  return (
    <AppShell
      title={
        activeRepository
          ? `Summary · ${activeRepository.fullName}`
          : 'Project summary'
      }
      subtitle="Where the project stands right now, built from real activity on GitHub. Read it, copy it or share it."
      breadcrumbs={
        activeRepository
          ? [
              { label: 'Projects', to: '/projects' },
              { label: activeRepository.fullName, to: `/projects/${activeRepository.id}` },
              { label: 'Summary' },
            ]
          : undefined
      }
      actions={
        activeRepository && resumeReport ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              loading={refreshing}
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void handleRefreshMemory()}
            >
              Update
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={handleExportMarkdown}
            >
              Download
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              onClick={() => void handleCopyContext()}
            >
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </>
        ) : undefined
      }
      bottomBar={bottomActionBar}
    >
      {loading ? (
        <div className="space-y-4">
          <div className="h-24 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
          <div className="h-64 rounded-2xl border border-[#252D24] bg-[#121512] animate-pulse" />
        </div>
      ) : !activeRepository || !synthesized || !resumeReport ? (
        <EmptyState
          icon={<FileCode2 className="w-5 h-5" />}
          title="No project yet"
          description="Add a project from GitHub and BuildLog will build its summary for you automatically."
          actionLabel="Add a project"
          onAction={() => navigate('/integrations')}
        />
      ) : (
        <div className="space-y-6">
          {/* Repo Selector & Format Switcher */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 rounded-2xl border border-[#252D24] bg-[#121512] p-4">
            <div className="flex flex-wrap items-center gap-3 min-w-0">
              <label htmlFor="memory-repo-select" className="text-xs text-[#929B90] shrink-0">
                Project
              </label>
              <select
                id="memory-repo-select"
                value={activeRepository.id}
                onChange={(e) => navigate(`/projects/${e.target.value}/memory`)}
                className="min-h-[38px] rounded-lg border border-[#252D24] bg-[#080908] px-3 py-1.5 text-sm text-[#FCFFEC] focus:outline-none focus:border-[#B8F34A]"
              >
                {repositories.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName}
                  </option>
                ))}
              </select>
              {storedMemory?.lastUpdatedAt && (
                <span className="text-xs text-[#929B90] tabular-nums">
                  Updated {formatShortDate(storedMemory.lastUpdatedAt)}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1 p-0.5 rounded-lg bg-[#080908] border border-[#252D24] self-start md:self-auto">
              <button
                type="button"
                onClick={() => setViewMode('structured')}
                className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  viewMode === 'structured'
                    ? 'bg-[#181B18] text-[#B8F34A]'
                    : 'text-[#929B90] hover:text-[#FCFFEC]'
                }`}
              >
                Summary
              </button>
              <button
                type="button"
                onClick={() => setViewMode('markdown')}
                className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  viewMode === 'markdown'
                    ? 'bg-[#181B18] text-[#B8F34A]'
                    : 'text-[#929B90] hover:text-[#FCFFEC]'
                }`}
              >
                Plain text
              </button>
              <button
                type="button"
                onClick={() => setViewMode('prompt')}
                className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  viewMode === 'prompt'
                    ? 'bg-[#181B18] text-[#B8F34A]'
                    : 'text-[#929B90] hover:text-[#FCFFEC]'
                }`}
              >
                For AI assistants
              </button>
            </div>
          </div>

          {/* 5-Column Vital Signs Strip */}
          <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="rounded-xl border border-[#252D24] bg-[#121512] p-3.5">
              <div className="flex items-center justify-between text-[11px] text-[#929B90]">
                <span>Updates</span>
                <GitCommit className="w-3.5 h-3.5 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-1.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {repoEvents.length}
              </p>
            </div>
            <div className="rounded-xl border border-[#252D24] bg-[#121512] p-3.5">
              <div className="flex items-center justify-between text-[11px] text-[#929B90]">
                <span>Parts changed</span>
                <FolderGit2 className="w-3.5 h-3.5 text-[#B8F34A]" aria-hidden="true" />
              </div>
              <p className="mt-1.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.modifiedCodeAreas.length}
              </p>
            </div>
            <div className="rounded-xl border border-[#252D24] bg-[#121512] p-3.5">
              <div className="flex items-center justify-between text-[11px] text-[#929B90]">
                <span>Waiting for review</span>
                <GitPullRequest className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
              </div>
              <p className="mt-1.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.openPullRequests.length}
              </p>
            </div>
            <div className="rounded-xl border border-[#252D24] bg-[#121512] p-3.5">
              <div className="flex items-center justify-between text-[11px] text-[#929B90]">
                <span>Open problems</span>
                <AlertTriangle className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
              </div>
              <p className="mt-1.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.openIssues.length}
              </p>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl border border-[#252D24] bg-[#121512] p-3.5">
              <div className="flex items-center justify-between text-[11px] text-[#929B90]">
                <span>Blockers</span>
                <Terminal className="w-3.5 h-3.5 text-red-300" aria-hidden="true" />
              </div>
              <p className="mt-1.5 text-xl font-display font-bold tabular-nums text-[#FCFFEC]">
                {synthesized.knownBlockers.length}
              </p>
            </div>
          </section>

          {resumeReport.hasInsufficientHistory && (
            <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-200 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p className="font-medium">There isn't much activity yet</p>
                <p className="mt-0.5 text-amber-200/80">
                  This summary will fill in as work happens. You can also check for updates on the{' '}
                  <Link to={`/projects/${activeRepository.id}`} className="underline">
                    project page
                  </Link>
                  .
                </p>
              </div>
            </div>
          )}

          {viewMode === 'markdown' || viewMode === 'prompt' ? (
            <div className="rounded-2xl border border-[#252D24] bg-[#121512] overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-[#252D24] bg-[#0D0F0D] flex items-center justify-between gap-4 text-xs text-[#929B90]">
                <span className="truncate">
                  {viewMode === 'prompt'
                    ? 'Paste this into ChatGPT, Claude or another AI assistant to bring it up to speed.'
                    : 'Paste this into an email, doc or chat.'}
                </span>
              </div>
              <pre className="p-5 text-xs font-mono text-[#F3F5EF] leading-relaxed whitespace-pre-wrap break-words">
                {activeCopyText}
              </pre>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-5">
                <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Overview
                  </h2>
                  <p className="text-sm text-[#F3F5EF]/90 leading-relaxed">
                    {synthesized.projectOverview}
                  </p>
                  <div className="pt-3 border-t border-[#252D24]">
                    <p className="text-xs text-[#929B90]">Goal</p>
                    <p className="mt-1 text-sm text-[#FCFFEC]">
                      {synthesized.objective || 'No goal set yet. You can add one on the project page.'}
                    </p>
                  </div>
                </section>

                <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    What changed recently
                  </h2>
                  {synthesized.recentChanges.length > 0 ? (
                    <ul className="space-y-1.5 text-xs text-[#F3F5EF]/90">
                      {synthesized.recentChanges.map((item, idx) => (
                        <li key={idx} className="leading-relaxed">
                          • {item}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[#929B90]">No changes yet.</p>
                  )}
                </section>

                <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Parts of the project that changed
                  </h2>
                  {synthesized.modifiedCodeAreas.length > 0 ? (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono text-[#B8F34A]">
                      {synthesized.modifiedCodeAreas.map((area, idx) => (
                        <li
                          key={idx}
                          className="rounded-lg border border-[#252D24] bg-[#080908] px-3 py-2 truncate"
                        >
                          {area}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-[#929B90]">Nothing yet.</p>
                  )}
                </section>
              </div>

              <div className="lg:col-span-5 space-y-5">
                <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Still open
                  </h2>
                  <div className="space-y-3 text-xs">
                    <div>
                      <p className="text-[#B8F34A] mb-1">
                        Waiting for review: pull requests ({synthesized.openPullRequests.length})
                      </p>
                      {synthesized.openPullRequests.length > 0 ? (
                        <ul className="space-y-1 text-[#F3F5EF]">
                          {synthesized.openPullRequests.map((pr, i) => (
                            <li key={i}>• {pr}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#929B90]">None right now.</p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-[#252D24]">
                      <p className="text-amber-300 mb-1">
                        Open problems: issues ({synthesized.openIssues.length})
                      </p>
                      {synthesized.openIssues.length > 0 ? (
                        <ul className="space-y-1 text-[#F3F5EF]">
                          {synthesized.openIssues.map((iss, i) => (
                            <li key={i}>• {iss}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#929B90]">None right now.</p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-[#252D24]">
                      <p className="text-red-300 mb-1">
                        Blockers ({synthesized.knownBlockers.length})
                      </p>
                      {synthesized.knownBlockers.length > 0 ? (
                        <ul className="space-y-1 text-red-200">
                          {synthesized.knownBlockers.map((b, i) => (
                            <li key={i}>• {b}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[#929B90]">No blockers right now.</p>
                      )}
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 space-y-3">
                  <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                    Suggested next steps
                  </h2>
                  {synthesized.suggestedNextSteps.length > 0 ? (
                    <ol className="space-y-1.5 text-xs text-[#F3F5EF] list-decimal list-inside">
                      {synthesized.suggestedNextSteps.map((step, i) => (
                        <li key={i} className="leading-relaxed">
                          {step}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="text-xs text-[#929B90]">
                      Suggestions will appear once there's some recent activity.
                    </p>
                  )}

                  {resumeReport.relevantLinks.length > 0 && (
                    <div className="pt-3 border-t border-[#252D24]">
                      <p className="text-xs text-[#929B90] mb-1.5">Links on GitHub</p>
                      <ul className="space-y-1">
                        {resumeReport.relevantLinks.slice(0, 5).map((url) => (
                          <li key={url}>
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-[#B8F34A] hover:underline break-all"
                            >
                              <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>{url}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
