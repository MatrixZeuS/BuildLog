import React from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock,
  GitCommit,
  GitPullRequest,
  Link2,
  PauseCircle,
  Unplug,
  CircleDot,
} from 'lucide-react';
import type {
  GitHubEventType,
  IntegrationStatus,
  ProcessingStatus,
  RepositoryStatus,
} from '../../types/models';
import { cn } from '../../utils/cn';

const REPO_STATUS_META: Record<
  RepositoryStatus,
  { label: string; colorClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  active: { label: 'Active', colorClass: 'text-[#B8F34A]', Icon: Activity },
  paused: { label: 'Paused', colorClass: 'text-amber-300', Icon: PauseCircle },
  disconnected: { label: 'Disconnected', colorClass: 'text-[#929B90]', Icon: Unplug },
};

export function RepositoryStatusLabel({
  status,
  className,
}: {
  status: RepositoryStatus;
  className?: string;
}) {
  const meta = REPO_STATUS_META[status] ?? REPO_STATUS_META.active;
  const Icon = meta.Icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0', meta.colorClass, className)}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

const PROCESSING_META: Record<
  ProcessingStatus,
  { label: string; colorClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  pending: { label: 'Not summarized yet', colorClass: 'text-amber-300', Icon: Clock },
  summarized: { label: 'Summarized', colorClass: 'text-[#B8F34A]', Icon: CheckCircle2 },
  recorded_without_summary: {
    label: 'Saved',
    colorClass: 'text-[#929B90]',
    Icon: CheckCircle2,
  },
  failed: { label: "Couldn't summarize", colorClass: 'text-red-300', Icon: AlertCircle },
};

export function ProcessingStatusLabel({
  status,
  className,
}: {
  status: ProcessingStatus;
  className?: string;
}) {
  const meta = PROCESSING_META[status] ?? PROCESSING_META.pending;
  const Icon = meta.Icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0', meta.colorClass, className)}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

const INTEGRATION_META: Record<
  IntegrationStatus,
  { label: string; colorClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  connected: { label: 'Connected', colorClass: 'text-[#B8F34A]', Icon: Link2 },
  pending: { label: 'Setting up', colorClass: 'text-amber-300', Icon: Clock },
  disconnected: { label: 'Disconnected', colorClass: 'text-[#929B90]', Icon: Unplug },
  error: { label: 'Attention needed', colorClass: 'text-red-300', Icon: AlertCircle },
};

export function IntegrationStatusLabel({
  status,
  className,
}: {
  status: IntegrationStatus;
  className?: string;
}) {
  const meta = INTEGRATION_META[status] ?? INTEGRATION_META.disconnected;
  const Icon = meta.Icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0', meta.colorClass, className)}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}

const EVENT_TYPE_META: Record<
  GitHubEventType,
  { label: string; colorClass: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  push: { label: 'Changes', colorClass: 'text-[#B8F34A]', Icon: GitCommit },
  pull_request: { label: 'Review (PR)', colorClass: 'text-emerald-300', Icon: GitPullRequest },
  issues: { label: 'Issue', colorClass: 'text-amber-300', Icon: CircleDot },
};

export function EventTypeLabel({
  eventType,
  className,
}: {
  eventType: GitHubEventType;
  className?: string;
}) {
  const meta = EVENT_TYPE_META[eventType] ?? EVENT_TYPE_META.push;
  const Icon = meta.Icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0', meta.colorClass, className)}>
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
