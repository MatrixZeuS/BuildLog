import type { ActivityCluster, ActivityEvent, Repository } from '../types/models';

const DEFAULT_CLUSTER_GAP_MS = 90 * 60 * 1000; // 90 minutes

export function clusterActivityEvents(
  events: ActivityEvent[],
  repositories: Repository[],
  gapMs: number = DEFAULT_CLUSTER_GAP_MS
): ActivityCluster[] {
  if (events.length === 0) return [];

  const repoNameMap = new Map(repositories.map((r) => [r.id, r.fullName]));

  // Group by repositoryId first, then sort chronologically ascending to build session clusters
  const byRepo = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const list = byRepo.get(event.repositoryId) ?? [];
    list.push(event);
    byRepo.set(event.repositoryId, list);
  }

  const clusters: ActivityCluster[] = [];

  for (const [repositoryId, repoEvents] of byRepo.entries()) {
    const sortedAsc = [...repoEvents].sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );

    let currentGroup: ActivityEvent[] = [];

    const flushGroup = (group: ActivityEvent[]) => {
      if (group.length === 0) return;
      const startAt = group[0].occurredAt;
      const endAt = group[group.length - 1].occurredAt;
      const branches = Array.from(
        new Set(group.map((e) => e.branch.trim()).filter(Boolean))
      );
      const changedFiles = Array.from(
        new Set(group.flatMap((e) => e.changedFiles).filter(Boolean))
      ).slice(0, 30);

      const repoName = repoNameMap.get(repositoryId) ?? 'Connected repository';

      clusters.push({
        clusterId: `${repositoryId}-${startAt.getTime()}`,
        repositoryId,
        repositoryName: repoName,
        isInferred: true,
        label: `Work session · ${group.length} ${group.length === 1 ? 'update' : 'updates'}`,
        startAt,
        endAt,
        eventCount: group.length,
        events: [...group].reverse(), // Most recent first inside cluster
        branches,
        changedFiles,
      });
    };

    for (const ev of sortedAsc) {
      if (currentGroup.length === 0) {
        currentGroup.push(ev);
        continue;
      }
      const prev = currentGroup[currentGroup.length - 1];
      if (ev.occurredAt.getTime() - prev.occurredAt.getTime() <= gapMs) {
        currentGroup.push(ev);
      } else {
        flushGroup(currentGroup);
        currentGroup = [ev];
      }
    }
    flushGroup(currentGroup);
  }

  return clusters.sort((a, b) => b.endAt.getTime() - a.endAt.getTime());
}
