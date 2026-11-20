import type {
  GitHubAppConfigStatus,
  Integration,
  Repository,
  WebhookDeliveryRecord,
} from '../types/models';

export type WebhookHealthLevel =
  | 'healthy'
  | 'awaiting_events'
  | 'degraded'
  | 'setup_required';

export interface WebhookHealthSummary {
  level: WebhookHealthLevel;
  headline: string;
  description: string;
  serverReady: boolean;
  connectedInstallationsCount: number;
  activeReposCount: number;
  latestSyncedAt: Date | null;
  latestWebhookAt: Date | null;
  deliveryCount: number;
  failedOrUnmappedCount: number;
  lastCheckedAt: Date | null;
}

export interface ComputeWebhookHealthInput {
  githubStatus: GitHubAppConfigStatus | null;
  integrations: Integration[];
  repositories: Repository[];
  recentDeliveries: WebhookDeliveryRecord[];
  lastCheckedAt?: Date | null;
}

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let latest: Date | null = null;
  for (const d of dates) {
    if (!d || Number.isNaN(d.getTime())) continue;
    if (!latest || d.getTime() > latest.getTime()) {
      latest = d;
    }
  }
  return latest;
}

export function computeWebhookHealthStatus({
  githubStatus,
  integrations,
  repositories,
  recentDeliveries,
  lastCheckedAt = null,
}: ComputeWebhookHealthInput): WebhookHealthSummary {
  const connectedInstallations = integrations.filter((i) => i.status === 'connected');
  const erroredInstallations = integrations.filter((i) => i.status === 'error');
  const activeReposCount = repositories.filter((r) => r.status === 'active').length;

  const latestSyncedAt = maxDate(repositories.map((r) => r.lastSyncedAt));

  const deliveryDates = recentDeliveries
    .map((d) => new Date(d.receivedAt))
    .filter((d) => !Number.isNaN(d.getTime()));
  const integrationWebhookDates = integrations.map((i) => i.lastWebhookAt);
  const latestWebhookAt = maxDate([...deliveryDates, ...integrationWebhookDates]);

  const failedOrUnmappedCount = recentDeliveries.filter(
    (d) => d.processingStatus === 'failed' || d.processingStatus === 'unmapped_repository'
  ).length;

  const serverReady = Boolean(
    githubStatus?.configured && githubStatus?.oauthConfigured && githubStatus?.webhookConfigured
  );

  let level: WebhookHealthLevel;
  let headline: string;
  let description: string;

  if (!githubStatus) {
    if (connectedInstallations.length === 0) {
      level = 'setup_required';
      headline = 'No projects yet';
      description =
        'Connect a GitHub project and BuildLog will start tracking the work on it automatically.';
    } else if (erroredInstallations.length > 0 || failedOrUnmappedCount > 0) {
      level = 'degraded';
      headline = 'Needs attention';
      description =
        "Some recent updates from GitHub couldn't be processed. See Technical details on the Connections page.";
    } else if (latestWebhookAt) {
      level = 'healthy';
      headline = 'Working';
      description =
        'Changes from GitHub are arriving and your project summaries are up to date.';
    } else {
      level = 'awaiting_events';
      headline = 'Connected';
      description =
        'Your projects are connected. New changes will show up here as soon as they happen on GitHub.';
    }
  } else if (!serverReady || connectedInstallations.length === 0) {
    level = 'setup_required';
    headline = serverReady ? 'Ready to connect' : 'Setup not finished';
    if (!serverReady) {
      description =
        "GitHub connections aren't set up on this BuildLog yet. Ask whoever runs it to finish setup (see Technical details).";
    } else {
      description =
        'Paste a GitHub project link to start tracking its work automatically.';
    }
  } else if (erroredInstallations.length > 0 || failedOrUnmappedCount > 0) {
    level = 'degraded';
    headline = 'Needs attention';
    description =
      failedOrUnmappedCount > 0
        ? `${failedOrUnmappedCount} recent ${failedOrUnmappedCount === 1 ? "update from GitHub couldn't" : "updates from GitHub couldn't"} be processed. See Technical details on the Connections page.`
        : 'A linked GitHub account needs to be reconnected.';
  } else if (latestWebhookAt) {
    level = 'healthy';
    headline = 'Working';
    description =
      'Changes from GitHub are arriving automatically.';
  } else {
    level = 'awaiting_events';
    headline = 'Connected';
    description =
      'Your projects are connected. New changes will show up here as soon as they happen on GitHub.';
  }

  return {
    level,
    headline,
    description,
    serverReady,
    connectedInstallationsCount: connectedInstallations.length,
    activeReposCount,
    latestSyncedAt,
    latestWebhookAt,
    deliveryCount: recentDeliveries.length,
    failedOrUnmappedCount,
    lastCheckedAt,
  };
}
