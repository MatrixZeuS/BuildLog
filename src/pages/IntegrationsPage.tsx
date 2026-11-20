import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  GitBranch,
  Loader2,
  Lock,
  Plug,
  ShieldCheck,
  Sparkles,
  Unplug,
} from 'lucide-react';
import { AppShell } from '../components/layout/AppShell';
import { WebhookHealthCard } from '../components/integrations/WebhookHealthCard';
import { Button, getButtonClasses } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Input } from '../components/ui/FormFields';
import { IntegrationStatusLabel, RepositoryStatusLabel } from '../components/ui/StatusLabel';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useWorkspace } from '../contexts/WorkspaceContext';
import {
  completeGitHubAuthorization,
  disconnectInstallationOnServer,
  importRepositoryHistoryFromGitHub,
  prepareRepositoryConnect,
  syncInstallationMappingToServer,
} from '../services/apiClient';
import {
  disconnectIntegrationAndRepos,
  ingestNormalizedEventsToFirestore,
  saveGitHubIntegration,
  upsertConnectedRepository,
} from '../services/dbService';
import type {
  ActivityEvent,
  Integration,
  RemoteGitHubRepository,
  Repository,
} from '../types/models';
import { formatRelativeDate, formatShortDate } from '../utils/dateUtils';
import { parseGitHubRepositoryUrl } from '../utils/githubUrl';
import { parseFriendlyFirestoreError } from '../lib/firebase';

type ConnectionPhase =
  | 'idle'
  | 'checking'
  | 'authorization_required'
  | 'verifying'
  | 'importing'
  | 'connected'
  | 'error';

interface ConnectionFlowState {
  phase: ConnectionPhase;
  targetFullName: string;
  authorizeUrl?: string;
  authorizeReason?: string;
  importedCount?: number;
  connectedRepoId?: string;
  connectedRepo?: RemoteGitHubRepository;
  errorMessage?: string;
}

const STEP_ORDER: Array<{ key: string; label: string }> = [
  { key: 'url', label: 'Check link' },
  { key: 'auth', label: 'Allow access' },
  { key: 'import', label: 'Copy recent work' },
  { key: 'webhook', label: 'Live updates on' },
];

function getCompletedStepIndex(phase: ConnectionPhase): number {
  switch (phase) {
    case 'checking':
      return 0;
    case 'authorization_required':
    case 'verifying':
      return 1;
    case 'importing':
      return 2;
    case 'connected':
      return 4;
    default:
      return -1;
  }
}

export function IntegrationsPage() {
  const { user } = useAuth();
  const {
    integrations,
    repositories,
    recentDeliveries,
    githubStatus,
    refreshProjectMemory,
  } = useWorkspace();
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [repositoryUrl, setRepositoryUrl] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [flow, setFlow] = useState<ConnectionFlowState>({
    phase: 'idle',
    targetFullName: '',
  });

  const [disconnectTarget, setDisconnectTarget] = useState<Integration | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const callbackHandledRef = useRef<string | null>(null);
  const diagnosticsSectionRef = useRef<HTMLElement | null>(null);
  const isEmbeddedIframe = typeof window !== 'undefined' && window.self !== window.top;

  const finalizeRepositoryConnection = useCallback(
    async (authorized: {
      installationId: string;
      accountName: string;
      repository: RemoteGitHubRepository;
    }) => {
      if (!user) {
        throw new Error('You must be signed in to connect a repository.');
      }
      if (!authorized?.repository?.fullName) {
        throw new Error(
          'GitHub repository details were missing from the server authorization response.'
        );
      }

      setFlow({
        phase: 'importing',
        targetFullName: authorized.repository.fullName,
      });

      // 1. Fetch historical repository activity first to confirm live server access
      const { events } = await importRepositoryHistoryFromGitHub({
        installationId: authorized.installationId,
        fullName: authorized.repository.fullName,
        defaultBranch: authorized.repository.defaultBranch,
      });

      // 2. Register verified GitHub installation & repository in Firestore
      const existingInst = integrations.find(
        (i) => i.installationId === authorized.installationId
      );
      const integrationId = await saveGitHubIntegration(
        user.uid,
        authorized.installationId,
        authorized.accountName,
        existingInst?.id
      );

      const existingRepo = repositories.find(
        (r) =>
          r.githubRepositoryId === authorized.repository.githubRepositoryId &&
          r.integrationId === integrationId
      );

      const repoDocId = await upsertConnectedRepository(
        user.uid,
        integrationId,
        authorized.repository,
        existingRepo
      );

      // 3. Persist imported historical events & synthesize initial project memory
      const insertedIds = await ingestNormalizedEventsToFirestore(
        user.uid,
        repoDocId,
        events
      );

      const repoRecord: Repository = {
        id: repoDocId,
        ownerId: user.uid,
        integrationId,
        githubRepositoryId: authorized.repository.githubRepositoryId,
        fullName: authorized.repository.fullName,
        description: authorized.repository.description,
        defaultBranch: authorized.repository.defaultBranch,
        primaryLanguage: authorized.repository.primaryLanguage,
        lastSyncedAt: new Date(),
        status: 'active',
        objective: existingRepo?.objective ?? '',
        htmlUrl: authorized.repository.htmlUrl,
      };

      const syntheticEvents: ActivityEvent[] = events.map((ev, index) => ({
        id: insertedIds[index] ?? ev.eventId,
        ownerId: user.uid,
        repositoryId: repoDocId,
        eventId: ev.eventId,
        eventType: ev.eventType,
        branch: ev.branch,
        commitSha: ev.commitSha,
        title: ev.title,
        description: ev.description,
        sourceUrl: ev.sourceUrl,
        changedFiles: ev.changedFiles,
        occurredAt: new Date(ev.occurredAt),
        processingStatus: 'pending',
        author: ev.author,
        prNumber: ev.prNumber ?? null,
        prState: ev.prState ?? '',
        issueNumber: ev.issueNumber ?? null,
        issueState: ev.issueState ?? '',
      }));

      await refreshProjectMemory(repoRecord, syntheticEvents);

      // 4. Register repository in server webhook router (preserving any sibling repos on same installation)
      const existingLinkedMappings = repositories
        .filter((r) => r.integrationId === integrationId && r.id !== repoDocId)
        .map((r) => ({
          repositoryId: r.id,
          githubRepositoryId: r.githubRepositoryId,
          fullName: r.fullName,
          status: r.status,
        }));

      await syncInstallationMappingToServer({
        installationId: authorized.installationId,
        integrationId,
        accountName: authorized.accountName,
        repositories: [
          ...existingLinkedMappings,
          {
            repositoryId: repoDocId,
            githubRepositoryId: authorized.repository.githubRepositoryId,
            fullName: authorized.repository.fullName,
            status: 'active',
          },
        ],
      });

      setFlow({
        phase: 'connected',
        targetFullName: authorized.repository.fullName,
        importedCount: insertedIds.length,
        connectedRepoId: repoDocId,
        connectedRepo: authorized.repository,
      });

      setRepositoryUrl('');
      showToast(
        `Connected ${authorized.repository.fullName} and imported ${insertedIds.length} historical events.`,
        'success'
      );
    },
    [user, integrations, repositories, refreshProjectMemory, showToast]
  );

  // Handle automatic return from GitHub App installation & OAuth authorization
  useEffect(() => {
    const stateParam = searchParams.get('state');
    const codeParam = searchParams.get('code');
    const installationIdParam = searchParams.get('installation_id');
    const oauthErrorParam = searchParams.get('error_description') || searchParams.get('error');

    if (!stateParam && !oauthErrorParam) return;

    const callbackSignature = `${stateParam ?? ''}:${codeParam ?? ''}:${installationIdParam ?? ''}:${oauthErrorParam ?? ''}`;
    if (callbackHandledRef.current === callbackSignature) return;
    callbackHandledRef.current = callbackSignature;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('state');
    nextParams.delete('code');
    nextParams.delete('installation_id');
    nextParams.delete('setup_action');
    nextParams.delete('error');
    nextParams.delete('error_description');
    setSearchParams(nextParams, { replace: true });

    if (oauthErrorParam) {
      setFlow({
        phase: 'error',
        targetFullName: '',
        errorMessage: `Access wasn't granted on GitHub, so BuildLog can't read this project yet. Click Try again and approve access on GitHub.`,
      });
      return;
    }

    if (!user || !stateParam) return;

    void (async () => {
      setFlow({
        phase: 'verifying',
        targetFullName: 'GitHub repository',
      });

      try {
        const result = await completeGitHubAuthorization({
          state: stateParam,
          code: codeParam || undefined,
          installationId: installationIdParam || undefined,
          redirectUri: `${window.location.origin}/integrations`,
        });

        if (result.status === 'oauth_verification_required') {
          setFlow({
            phase: 'authorization_required',
            targetFullName: result.fullName,
            authorizeUrl: result.authorizeUrl,
            authorizeReason:
              'One more step: confirm on GitHub that this is your account, so BuildLog knows the project belongs to you.',
          });
          return;
        }

        if (result.status !== 'authorized' || !result.repository?.fullName) {
          throw new Error(
            "Something went wrong while checking access with GitHub. Please try again in a moment."
          );
        }

        await finalizeRepositoryConnection({
          installationId: result.installationId,
          accountName: result.accountName,
          repository: result.repository,
        });
      } catch (error) {
        setFlow({
          phase: 'error',
          targetFullName: '',
          errorMessage:
            error instanceof Error
              ? error.message
              : "We couldn't confirm access with GitHub. Please try again.",
        });
      }
    })();
  }, [searchParams, setSearchParams, user, finalizeRepositoryConnection]);

  const handleConnectRepository = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseGitHubRepositoryUrl(repositoryUrl);
    if (!parsed.valid) {
      setUrlError(parsed.error);
      return;
    }

    setUrlError(undefined);
    setFlow({
      phase: 'checking',
      targetFullName: parsed.fullName,
    });

    try {
      const response = await prepareRepositoryConnect(parsed.canonicalUrl);

      if (response.status === 'authorization_required') {
        setFlow({
          phase: 'authorization_required',
          targetFullName: response.fullName,
          authorizeUrl: response.authorizeUrl,
          authorizeReason: `GitHub will ask you to pick your account and choose ${response.fullName}. BuildLog can only read your project; it can never change it.`,
        });
        return;
      }

      if (response.status !== 'authorized' || !response.repository?.fullName) {
        throw new Error(
          "Something went wrong while checking this project. Please try again in a moment."
        );
      }

      await finalizeRepositoryConnection({
        installationId: response.installationId,
        accountName: response.accountName,
        repository: response.repository,
      });
    } catch (error) {
      setFlow({
        phase: 'error',
        targetFullName: parsed.fullName,
        errorMessage:
          error instanceof Error
            ? parseFriendlyFirestoreError(error, error.message)
            : "We couldn't connect this project. Please try again.",
      });
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectTarget) return;
    setDisconnecting(true);
    try {
      const linkedRepos = repositories.filter(
        (r) => r.integrationId === disconnectTarget.id
      );
      await disconnectIntegrationAndRepos(disconnectTarget.id, linkedRepos);
      await disconnectInstallationOnServer(disconnectTarget.installationId).catch(() => {});
      showToast(
        `Disconnected ${disconnectTarget.accountName}. BuildLog will stop receiving updates from it.`,
        'info'
      );
      setDisconnectTarget(null);
    } catch (error) {
      showToast(parseFriendlyFirestoreError(error, "Couldn't disconnect. Please try again."), 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  const activeStepIndex = getCompletedStepIndex(flow.phase);
  const showProgressStepper = flow.phase !== 'idle';

  return (
    <AppShell
      title="Connect a Project"
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Connections' }]}
      subtitle="Link a GitHub project and BuildLog will keep track of the work on it for you."
    >
      <div className="space-y-6 max-w-5xl">
        {/* Primary Customer Action: Connect Repository via URL */}
        <section
          id="connect-repository"
          className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6 space-y-5"
        >
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-display font-semibold text-[#FCFFEC]">
              Add a project from GitHub
            </h2>
            <p className="text-xs sm:text-sm text-[#929B90]">
              Paste the link to your project on GitHub. We'll ask GitHub for permission to read it (never to change it), copy your recent work, and keep it up to date from then on.
            </p>
          </div>

          <form
            onSubmit={handleConnectRepository}
            className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
            noValidate
          >
            <div className="flex-1">
              <Input
                label="Project link"
                type="url"
                value={repositoryUrl}
                onChange={(e) => {
                  setRepositoryUrl(e.target.value);
                  if (urlError) setUrlError(undefined);
                }}
                placeholder="e.g. https://github.com/your-name/your-project"
                error={urlError}
                disabled={flow.phase === 'checking' || flow.phase === 'verifying' || flow.phase === 'importing'}
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={flow.phase === 'checking'}
              disabled={flow.phase === 'verifying' || flow.phase === 'importing'}
              icon={<Plug className="w-4 h-4" />}
            >
              Connect
            </Button>
          </form>

          {/* Clear Connection Progress Stepper */}
          {showProgressStepper && (
            <div className="rounded-xl border border-[#252D24] bg-[#080908] p-4 space-y-4">
              <ol
                aria-label="Repository connection progress"
                className="grid grid-cols-2 sm:grid-cols-4 gap-3"
              >
                {STEP_ORDER.map((step, idx) => {
                  const isDone =
                    flow.phase === 'connected' ||
                    (flow.phase !== 'error' && idx < activeStepIndex);
                  const isCurrent = flow.phase !== 'error' && idx === activeStepIndex;

                  return (
                    <li
                      key={step.key}
                      className={`rounded-lg border px-3 py-2 flex items-center gap-2 text-xs ${
                        isDone
                          ? 'border-[#B8F34A]/40 bg-[#B8F34A]/10 text-[#B8F34A]'
                          : isCurrent
                            ? 'border-[#B8F34A]/60 bg-[#121512] text-[#FCFFEC]'
                            : 'border-[#252D24] bg-[#0D0F0D] text-[#929B90]'
                      }`}
                    >
                      {isDone ? (
                        <Check className="w-3.5 h-3.5 shrink-0 text-[#B8F34A]" aria-hidden="true" />
                      ) : isCurrent ? (
                        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[#B8F34A]" aria-hidden="true" />
                      ) : (
                        <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[11px] tabular-nums shrink-0">
                          {idx + 1}
                        </span>
                      )}
                      <span className="truncate">{step.label}</span>
                    </li>
                  );
                })}
              </ol>

              {/* State 1: Authorization Required */}
              {flow.phase === 'authorization_required' && flow.authorizeUrl && (
                <div className="rounded-xl border border-[#B8F34A]/35 bg-[#121512] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <p className="text-sm font-display font-semibold text-[#FCFFEC]">
                      Allow BuildLog to read{' '}
                      <span className="text-[#B8F34A]">{flow.targetFullName}</span>
                    </p>
                    <p className="text-xs text-[#929B90] leading-relaxed">
                      {flow.authorizeReason ||
                        'Choose your account on GitHub and select this project. You will come back here automatically.'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFlow({ phase: 'idle', targetFullName: '' })}
                    >
                      Cancel
                    </Button>
                    <a
                      href={flow.authorizeUrl}
                      target={isEmbeddedIframe ? '_blank' : '_self'}
                      rel={isEmbeddedIframe ? 'noreferrer' : undefined}
                      className={getButtonClasses('primary', 'md')}
                    >
                      <ExternalLink className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>Continue to GitHub</span>
                    </a>
                  </div>
                </div>
              )}

              {/* State 2: Verifying / Importing */}
              {(flow.phase === 'verifying' || flow.phase === 'importing') && (
                <div className="rounded-xl border border-[#252D24] bg-[#121512] p-4 flex items-center gap-3">
                  <Loader2
                    className="w-5 h-5 text-[#B8F34A] animate-spin shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-[#FCFFEC]">
                      {flow.phase === 'verifying'
                        ? 'Checking access with GitHub…'
                        : `Copying recent work from ${flow.targetFullName}…`}
                    </p>
                    <p className="text-xs text-[#929B90]">
                      {flow.phase === 'verifying'
                        ? 'This usually takes a few seconds.'
                        : 'Saving your recent changes and turning on live updates. This can take up to a minute.'}
                    </p>
                  </div>
                </div>
              )}

              {/* State 3: Connected */}
              {flow.phase === 'connected' && (
                <div className="rounded-xl border border-[#B8F34A]/45 bg-[#121512] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    <CheckCircle2
                      className="w-5 h-5 text-[#B8F34A] shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="space-y-1 min-w-0">
                      <p className="text-sm font-display font-semibold text-[#FCFFEC]">
                        {flow.targetFullName} is connected
                      </p>
                      <p className="text-xs text-[#929B90] tabular-nums">
                        Copied {flow.importedCount ?? 0} recent{' '}
                        {flow.importedCount === 1 ? 'update' : 'updates'}. New changes will appear automatically.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {flow.connectedRepoId && (
                      <Link
                        to={`/projects/${flow.connectedRepoId}`}
                        className={getButtonClasses('secondary', 'sm')}
                      >
                        <span>Open project</span>
                      </Link>
                    )}
                    <Link to="/dashboard" className={getButtonClasses('primary', 'sm')}>
                      <span>Go to dashboard</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              )}

              {/* State 4: Error */}
              {flow.phase === 'error' && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/40 bg-red-950/25 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-semibold text-red-200">
                        We couldn't connect this project
                      </p>
                      <p className="text-xs text-red-200/85 leading-relaxed">
                        {flow.errorMessage}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setFlow({ phase: 'idle', targetFullName: '' })}
                  >
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Connected Repositories & Accounts */}
        <section className="rounded-2xl border border-[#252D24] bg-[#121512] p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-display font-semibold text-[#FCFFEC]">
                Your projects
              </h2>
              <p className="mt-0.5 text-xs text-[#929B90]">
                These projects update automatically whenever work happens on GitHub.
              </p>
            </div>
            {repositories.length > 0 && (
              <Link to="/dashboard" className={getButtonClasses('ghost', 'sm')}>
                <span>Dashboard</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              </Link>
            )}
          </div>

          {repositories.length === 0 ? (
            <p className="text-sm text-[#929B90]">
              No projects yet. Paste a GitHub link above to add your first one.
            </p>
          ) : (
            <ul className="divide-y divide-[#252D24]">
              {repositories.map((repo) => (
                <li
                  key={repo.id}
                  className="py-3.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <GitBranch className="w-4 h-4 text-[#B8F34A] shrink-0" aria-hidden="true" />
                      <Link
                        to={`/projects/${repo.id}`}
                        className="text-sm font-display font-semibold text-[#FCFFEC] hover:text-[#B8F34A] truncate"
                      >
                        {repo.fullName}
                      </Link>
                      <RepositoryStatusLabel status={repo.status} />
                    </div>
                    <p className="text-xs text-[#929B90] tabular-nums">
                      {repo.primaryLanguage ? `${repo.primaryLanguage} · ` : ''}Updated{' '}
                      {repo.lastSyncedAt ? formatRelativeDate(repo.lastSyncedAt) : 'not yet'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      to={`/projects/${repo.id}/memory`}
                      className={getButtonClasses('secondary', 'sm')}
                    >
                      Project summary
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {integrations.length > 0 && (
            <div className="pt-4 border-t border-[#252D24] space-y-3">
              <h3 className="text-xs uppercase tracking-wider text-[#929B90]">
                Linked GitHub accounts
              </h3>
              <ul className="divide-y divide-[#252D24]">
                {integrations.map((inst) => {
                  const linkedCount = repositories.filter(
                    (r) => r.integrationId === inst.id && r.status !== 'disconnected'
                  ).length;
                  return (
                    <li
                      key={inst.id}
                      className="py-2.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-sm font-medium text-[#FCFFEC]">
                          {inst.accountName}
                        </span>
                        <IntegrationStatusLabel status={inst.status} />
                        <span className="text-xs text-[#929B90] tabular-nums">
                          · {linkedCount} {linkedCount === 1 ? 'project' : 'projects'} · Linked{' '}
                          {formatShortDate(inst.connectedAt)}
                        </span>
                      </div>

                      {inst.status !== 'disconnected' && (
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Unplug className="w-3.5 h-3.5" />}
                          onClick={() => setDisconnectTarget(inst)}
                        >
                          Disconnect
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Technical details (collapsed by default) */}
        <section
          ref={diagnosticsSectionRef}
          id="advanced-diagnostics"
          className="rounded-2xl border border-[#252D24] bg-[#121512] overflow-hidden"
        >
          <button
            type="button"
            aria-expanded={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen((prev) => !prev)}
            className="w-full px-5 sm:px-6 py-4 flex items-center justify-between gap-3 text-left hover:bg-[#181B18]/50 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <ShieldCheck className="w-4 h-4 text-[#B8F34A] shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <span className="text-sm font-display font-semibold text-[#FCFFEC] block">
                  Technical details
                </span>
                <span className="text-xs text-[#929B90] block truncate">
                  For troubleshooting. You don't need this to use BuildLog.
                </span>
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-[#929B90] shrink-0 transition-transform duration-200 ${
                diagnosticsOpen ? 'rotate-180' : ''
              }`}
              aria-hidden="true"
            />
          </button>

          {diagnosticsOpen && (
            <div className="px-5 sm:px-6 pb-6 pt-5 border-t border-[#252D24] space-y-5">
              <WebhookHealthCard variant="integrations" />

              {/* Server Capability Checks */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 space-y-1">
                  <p className="text-[11px] font-mono text-[#929B90]">GitHub App Auth</p>
                  <p
                    className={`text-sm font-semibold ${
                      githubStatus?.configured ? 'text-[#B8F34A]' : 'text-amber-300'
                    }`}
                  >
                    {githubStatus?.configured ? 'Configured (RS256)' : 'Missing Server Config'}
                  </p>
                </div>
                <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 space-y-1">
                  <p className="text-[11px] font-mono text-[#929B90]">User Verification</p>
                  <p
                    className={`text-sm font-semibold ${
                      githubStatus?.oauthConfigured ? 'text-[#B8F34A]' : 'text-amber-300'
                    }`}
                  >
                    {githubStatus?.oauthConfigured ? 'OAuth Enabled' : 'OAuth Config Needed'}
                  </p>
                </div>
                <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 space-y-1">
                  <p className="text-[11px] font-mono text-[#929B90]">Webhook Signatures</p>
                  <p
                    className={`text-sm font-semibold ${
                      githubStatus?.webhookConfigured ? 'text-[#B8F34A]' : 'text-amber-300'
                    }`}
                  >
                    {githubStatus?.webhookConfigured ? 'HMAC-SHA256 Active' : 'Secret Required'}
                  </p>
                </div>
                <div className="rounded-xl border border-[#252D24] bg-[#080908] p-3.5 space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-mono text-[#929B90]">
                    <span>Gemini Summarizer</span>
                    <Sparkles className="w-3.5 h-3.5 text-[#B8F34A]" aria-hidden="true" />
                  </div>
                  <p
                    className={`text-sm font-semibold ${
                      githubStatus?.geminiConfigured ? 'text-[#B8F34A]' : 'text-[#929B90]'
                    }`}
                  >
                    {githubStatus?.geminiConfigured ? 'Enabled (Optional)' : 'Raw Ingestion Mode'}
                  </p>
                </div>
              </div>

              {/* Host Configuration Warning (Diagnostics Only) */}
              {githubStatus &&
              (!githubStatus.configured ||
                !githubStatus.oauthConfigured ||
                !githubStatus.webhookConfigured) ? (
                <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 space-y-2 text-xs text-amber-100 leading-relaxed">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle
                      className="w-4 h-4 text-amber-300 shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div className="space-y-1">
                      <p className="font-semibold text-amber-200">
                        Server-side GitHub App environment variables are incomplete
                      </p>
                      <p className="text-amber-100/80">
                        Missing host variables:{' '}
                        <span className="font-mono text-amber-200">
                          {githubStatus.missingEnvVars.join(', ')}
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Read-Only Scope Matrix */}
              <div className="space-y-2">
                <p className="text-xs font-mono text-[#929B90]">
                  Read-Only Permissions Enforced by GitHub App
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {[
                    { scope: 'Repository Contents', access: 'Read-only' },
                    { scope: 'Pull Requests', access: 'Read-only' },
                    { scope: 'Issues', access: 'Read-only' },
                    { scope: 'Metadata', access: 'Read-only' },
                  ].map((perm) => (
                    <div
                      key={perm.scope}
                      className="rounded-xl border border-[#252D24] bg-[#080908] px-3.5 py-2.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-xs text-[#F3F5EF] truncate">{perm.scope}</span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-mono text-[#B8F34A] shrink-0">
                        <Lock className="w-3 h-3" aria-hidden="true" />
                        <span>{perm.access}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Verified Webhook Deliveries */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-mono text-[#929B90]">
                    Recent updates received from GitHub (webhooks)
                  </p>
                  <span className="text-[11px] font-mono text-[#929B90]">
                    Endpoint: {githubStatus?.webhookPath || '/api/webhooks/github'}
                  </span>
                </div>
                {recentDeliveries.length === 0 ? (
                  <p className="text-xs text-[#929B90]">
                    Nothing received yet. Make a change in a connected project to test it.
                  </p>
                ) : (
                  <ul className="divide-y divide-[#252D24] rounded-xl border border-[#252D24] bg-[#080908] px-4 text-xs">
                    {recentDeliveries.slice(0, 12).map((d) => (
                      <li
                        key={d.deliveryId}
                        className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-mono text-[#B8F34A]">{d.eventType}</span>{' '}
                          <span className="text-[#FCFFEC]">
                            {d.repositoryFullName || 'Repository'}
                          </span>{' '}
                          <span className="font-mono text-[#929B90]">
                            ({d.deliveryId.slice(0, 12)})
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono tabular-nums text-[#929B90]">
                          <span>{d.processingStatus}</span>
                          <span>{formatRelativeDate(new Date(d.receivedAt))}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(disconnectTarget)}
        onClose={() => setDisconnectTarget(null)}
        onConfirm={handleConfirmDisconnect}
        loading={disconnecting}
        title="Disconnect this GitHub account?"
        message={`BuildLog will stop receiving updates from ${
          disconnectTarget?.accountName ?? 'this account'
        } and its projects. Everything already saved stays in BuildLog unless you delete it in Settings.`}
        confirmLabel="Disconnect"
      />
    </AppShell>
  );
}
