import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Timestamp } from 'firebase-admin/firestore';
import { getServerFirestore } from './firebaseAdmin';
import { createFirestoreStateStoreAdapter, type StateCollection } from './firestoreStateStore';
import type {
  NormalizedGitHubEventPayload,
  RepositoryStatus,
  WebhookDeliveryRecord,
} from '../types/models';

export interface ServerRepositoryMapping {
  repositoryId: string;
  githubRepositoryId: string;
  fullName: string;
  status: RepositoryStatus;
}

export interface ServerInstallationMapping {
  installationId: string;
  ownerId: string;
  integrationId: string;
  accountName: string;
  updatedAt: string;
}

export interface ServerInstallationRepoRecord extends ServerRepositoryMapping {
  installationId: string;
  ownerId: string;
  updatedAt: string;
}

export interface ServerUserGitHubSession {
  uid: string;
  githubUserId: string;
  githubLogin: string;
  accessToken: string;
  verifiedInstallationIds: string[];
  updatedAt: string;
}

export interface PublicGitHubSessionSummary {
  uid: string;
  githubUserId: string;
  githubLogin: string;
  verifiedInstallationIds: string[];
  updatedAt: string;
}

export interface PendingGitHubAuthState {
  stateToken: string;
  uid: string;
  targetFullName: string;
  pendingInstallationId?: string;
  createdAt: string;
  consumed?: boolean;
  consumedAt?: string;
}

export interface PendingWebhookEvent {
  queueId: string;
  ownerId: string;
  repositoryId: string;
  githubRepositoryId: string;
  repositoryFullName: string;
  deliveryId: string;
  payload: NormalizedGitHubEventPayload;
  receivedAt: string;
}

export type WebhookDeliveryLeaseStatus = 'processing' | 'completed';

export interface WebhookDeliveryStateRecord {
  deliveryId: string;
  status: WebhookDeliveryLeaseStatus;
  leaseToken: string;
  leaseExpiresAt: string;
  claimedAt: string;
  renewedAt?: string;
  completedAt?: string;
  outcome?: string;
  attemptCount: number;
}

export type WebhookDeliveryLeaseAcquireResult =
  | {
      status: 'acquired';
      leaseToken: string;
      leaseExpiresAt: string;
      recovered: boolean;
      attemptCount: number;
    }
  | { status: 'already_completed' }
  | { status: 'in_progress'; leaseExpiresAt: string };

export interface WebhookLeaseCompleteResult {
  completed: boolean;
  reason?: 'not_found' | 'already_completed' | 'lease_lost' | 'lease_expired';
}

export interface BlobEntryWithMetadata<T = unknown> {
  data: T;
  etag?: string;
}

export interface BlobWriteResult {
  etag?: string;
  modified: boolean;
}

export interface BlobListEntry {
  key: string;
  etag: string;
}

export interface BlobStoreAdapter {
  getWithMetadata<T = unknown>(key: string): Promise<BlobEntryWithMetadata<T> | null>;
  setJSON(
    key: string,
    data: unknown,
    options?: { onlyIfNew?: boolean } | { onlyIfMatch?: string }
  ): Promise<BlobWriteResult>;
  delete(key: string): Promise<void>;
  listAll(prefix: string): Promise<BlobListEntry[]>;
}

export type StorageEnvironmentMode = 'firestore-production' | 'firestore-preview' | 'local-file';

export interface StorageEnvironmentResolution {
  mode: StorageEnvironmentMode;
  storeName: string;
  isDeployScoped: boolean;
}

export const PRODUCTION_STATE_COLLECTION = 'buildlog_server_state';
export const PREVIEW_STATE_COLLECTION = 'buildlog_server_state_preview';
export const DEFAULT_WEBHOOK_LEASE_MS = 45_000;
const AUTH_STATE_TTL_MS = 30 * 60 * 1000;
const MAX_DELIVERIES_PER_INSTALLATION = 40;

export function resolveStorageEnvironment(
  env: Record<string, string | undefined> = process.env
): StorageEnvironmentResolution {
  const useFirestore =
    Boolean(env.VERCEL) || (env.BUILDLOG_STORAGE ?? '').toLowerCase() === 'firestore';
  if (!useFirestore) {
    return {
      mode: 'local-file',
      storeName: 'local-file',
      isDeployScoped: false,
    };
  }

  const isProduction =
    env.VERCEL_ENV === 'production' ||
    (!env.VERCEL_ENV && (env.BUILDLOG_CONTEXT ?? '').toLowerCase() === 'production');

  if (isProduction) {
    return {
      mode: 'firestore-production',
      storeName: PRODUCTION_STATE_COLLECTION,
      isDeployScoped: false,
    };
  }

  // Preview and development deployments use a separate collection so they can never read,
  // overwrite, or delete production data.
  return {
    mode: 'firestore-preview',
    storeName: PREVIEW_STATE_COLLECTION,
    isDeployScoped: true,
  };
}

export function sanitizeGitHubSession(
  session: ServerUserGitHubSession
): PublicGitHubSessionSummary {
  return {
    uid: session.uid,
    githubUserId: session.githubUserId,
    githubLogin: session.githubLogin,
    verifiedInstallationIds: [...session.verifiedInstallationIds],
    updatedAt: session.updatedAt,
  };
}

function safeSegment(value: string): string {
  const trimmed = value.trim();
  if (/^[a-zA-Z0-9._-]{1,100}$/.test(trimmed) && trimmed !== '.' && trimmed !== '..') {
    return trimmed;
  }
  const prefix =
    trimmed
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'item';
  const digest = crypto.createHash('sha256').update(value).digest('hex').slice(0, 20);
  return `${prefix}_${digest}`;
}

function keyUserOAuth(uid: string): string {
  return `user-oauth/${safeSegment(uid)}`;
}

function keyUserInstPrefix(uid: string): string {
  return `user-inst/${safeSegment(uid)}/`;
}

function keyUserInst(uid: string, installationId: string): string {
  return `${keyUserInstPrefix(uid)}${safeSegment(installationId)}`;
}

function keyAuthState(stateToken: string): string {
  return `auth-state/${safeSegment(stateToken)}`;
}

function keyInstallation(installationId: string): string {
  return `installations/${safeSegment(installationId)}`;
}

function keyInstRepoPrefix(installationId: string): string {
  return `inst-repos/${safeSegment(installationId)}/`;
}

function keyInstRepo(installationId: string, githubRepositoryId: string): string {
  return `${keyInstRepoPrefix(installationId)}${safeSegment(githubRepositoryId)}`;
}

function keyRepoInstLinkPrefix(githubRepositoryId: string): string {
  return `repo-inst-link/${safeSegment(githubRepositoryId)}/`;
}

function keyRepoInstLink(githubRepositoryId: string, installationId: string): string {
  return `${keyRepoInstLinkPrefix(githubRepositoryId)}${safeSegment(installationId)}`;
}

function keyDeliveryState(deliveryId: string): string {
  return `delivery-state/${safeSegment(deliveryId)}`;
}

function keyDeliveriesPrefix(installationId: string): string {
  return `deliveries/${safeSegment(installationId || 'unassigned')}/`;
}

function keyDeliveryLog(installationId: string, receivedAt: string, deliveryId: string): string {
  const ts = Date.parse(receivedAt);
  const safeTs = Number.isNaN(ts) ? Date.now() : ts;
  const reverseTs = String(Math.max(0, 9_999_999_999_999 - safeTs)).padStart(13, '0');
  return `${keyDeliveriesPrefix(installationId)}${reverseTs}_${safeSegment(deliveryId)}`;
}

function keyPendingPrefix(ownerId: string): string {
  return `pending/${safeSegment(ownerId)}/`;
}

function keyPendingEvent(ownerId: string, queueId: string): string {
  return `${keyPendingPrefix(ownerId)}${safeSegment(queueId)}`;
}

interface LocalPersistedFile {
  entries: Record<string, { data: unknown; etag: string }>;
}

export function createLocalFileBlobStoreAdapter(
  filePath = path.resolve(process.cwd(), '.data', 'server-state.json')
): BlobStoreAdapter {
  let queue: Promise<unknown> = Promise.resolve();

  function runSerialized<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = queue.then(fn, fn);
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  function readFileState(): LocalPersistedFile {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(filePath)) {
      return { entries: {} };
    }
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<LocalPersistedFile>;
      if (parsed && parsed.entries && typeof parsed.entries === 'object') {
        return { entries: parsed.entries };
      }
    } catch (error) {
      console.error('Failed to read local webhookStore file, resetting clean state:', error);
    }
    return { entries: {} };
  }

  function writeFileState(state: LocalPersistedFile): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, filePath);
  }

  function makeEtag(): string {
    return `"${crypto.randomUUID()}"`;
  }

  return {
    async getWithMetadata<T = unknown>(key: string): Promise<BlobEntryWithMetadata<T> | null> {
      return runSerialized(() => {
        const state = readFileState();
        const entry = state.entries[key];
        if (!entry) return null;
        return {
          data: structuredClone(entry.data) as T,
          etag: entry.etag,
        };
      });
    },
    async setJSON(
      key: string,
      data: unknown,
      options?: { onlyIfNew?: boolean } | { onlyIfMatch?: string }
    ): Promise<BlobWriteResult> {
      return runSerialized(() => {
        const state = readFileState();
        const current = state.entries[key];

        if (options && 'onlyIfNew' in options && options.onlyIfNew) {
          if (current) {
            return { modified: false };
          }
        } else if (options && 'onlyIfMatch' in options && options.onlyIfMatch !== undefined) {
          if (!current || current.etag !== options.onlyIfMatch) {
            return { modified: false };
          }
        }

        const etag = makeEtag();
        state.entries[key] = {
          data: structuredClone(data),
          etag,
        };
        writeFileState(state);
        return { etag, modified: true };
      });
    },
    async delete(key: string): Promise<void> {
      return runSerialized(() => {
        const state = readFileState();
        if (key in state.entries) {
          delete state.entries[key];
          writeFileState(state);
        }
      });
    },
    async listAll(prefix: string): Promise<BlobListEntry[]> {
      return runSerialized(() => {
        const state = readFileState();
        return Object.entries(state.entries)
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => ({ key, etag: val.etag }));
      });
    },
  };
}

let activeCustomAdapter: BlobStoreAdapter | null = null;
let cachedDefaultLocalAdapter: BlobStoreAdapter | null = null;
const cachedFirestoreAdapters = new Map<string, BlobStoreAdapter>();

export function setWebhookStoreAdapterForTesting(adapter: BlobStoreAdapter | null): void {
  activeCustomAdapter = adapter;
}

export function getActiveBlobStore(
  env: Record<string, string | undefined> = process.env
): BlobStoreAdapter {
  if (activeCustomAdapter) {
    return activeCustomAdapter;
  }

  const resolved = resolveStorageEnvironment(env);
  if (resolved.mode === 'firestore-production' || resolved.mode === 'firestore-preview') {
    const cached = cachedFirestoreAdapters.get(resolved.storeName);
    if (cached) return cached;
    const collection = getServerFirestore().collection(
      resolved.storeName
    ) as unknown as StateCollection;
    const adapter = createFirestoreStateStoreAdapter(
      collection,
      (seconds, nanoseconds) => new Timestamp(seconds, nanoseconds)
    );
    cachedFirestoreAdapters.set(resolved.storeName, adapter);
    return adapter;
  }

  if (!cachedDefaultLocalAdapter) {
    cachedDefaultLocalAdapter = createLocalFileBlobStoreAdapter();
  }
  return cachedDefaultLocalAdapter;
}

interface StoredUserOAuthRecord {
  uid: string;
  githubUserId: string;
  githubLogin: string;
  accessToken: string;
  updatedAt: string;
}

interface StoredUserInstallationRecord {
  uid: string;
  installationId: string;
  verifiedAt: string;
}

interface RepoInstallationLinkRecord {
  installationId: string;
  ownerId: string;
  repositoryId: string;
  githubRepositoryId: string;
  fullName: string;
  status: RepositoryStatus;
  updatedAt: string;
}

export function createWebhookStore(
  getStoreAdapter: () => BlobStoreAdapter = () => getActiveBlobStore()
) {
  async function readJson<T>(key: string): Promise<T | null> {
    const entry = await getStoreAdapter().getWithMetadata<T>(key);
    return entry ? entry.data : null;
  }

  async function deleteKeys(keys: string[]): Promise<void> {
    const store = getStoreAdapter();
    await Promise.all(keys.map((key) => store.delete(key)));
  }

  return {
    async createPendingAuthState(
      uid: string,
      targetFullName: string,
      pendingInstallationId?: string
    ): Promise<string> {
      const store = getStoreAdapter();
      const stateToken = crypto.randomBytes(24).toString('hex');
      const record: PendingGitHubAuthState = {
        stateToken,
        uid,
        targetFullName,
        ...(pendingInstallationId ? { pendingInstallationId } : {}),
        createdAt: new Date().toISOString(),
        consumed: false,
      };
      const result = await store.setJSON(keyAuthState(stateToken), record, { onlyIfNew: true });
      if (!result.modified) {
        throw new Error('Failed to create unique OAuth state token.');
      }
      return stateToken;
    },

    async consumePendingAuthState(
      uid: string,
      stateToken: string,
      options?: { nowMs?: number }
    ): Promise<PendingGitHubAuthState | null> {
      const cleanToken = stateToken.trim();
      if (!cleanToken) return null;

      const store = getStoreAdapter();
      const key = keyAuthState(cleanToken);
      const entry = await store.getWithMetadata<PendingGitHubAuthState>(key);
      if (!entry) return null;

      const record = entry.data;
      const nowMs = options?.nowMs ?? Date.now();
      const createdMs = Date.parse(record.createdAt);
      const isExpired = Number.isNaN(createdMs) || nowMs - createdMs > AUTH_STATE_TTL_MS;

      if (isExpired) {
        await store.delete(key).catch(() => {});
        return null;
      }

      // Never allow another user to consume or delete someone else's pending state
      if (record.uid !== uid || record.consumed) {
        return null;
      }

      if (!entry.etag) {
        return null;
      }

      const claimedRecord: PendingGitHubAuthState = {
        ...record,
        consumed: true,
        consumedAt: new Date(nowMs).toISOString(),
      };
      const claim = await store.setJSON(key, claimedRecord, {
        onlyIfMatch: entry.etag,
      });

      if (!claim.modified) {
        return null;
      }

      await store.delete(key).catch(() => {});
      return record;
    },

    async grantUserVerifiedInstallations(
      uid: string,
      installationIds: string[]
    ): Promise<void> {
      const uniqueIds = Array.from(
        new Set(installationIds.map((id) => id.trim()).filter(Boolean))
      );
      if (uniqueIds.length === 0) return;

      const store = getStoreAdapter();
      const nowIso = new Date().toISOString();
      await Promise.all(
        uniqueIds.map((installationId) => {
          const rec: StoredUserInstallationRecord = {
            uid,
            installationId,
            verifiedAt: nowIso,
          };
          return store.setJSON(keyUserInst(uid, installationId), rec);
        })
      );
    },

    async revokeUserVerifiedInstallation(uid: string, installationId: string): Promise<void> {
      const cleanId = installationId.trim();
      if (!cleanId) return;
      await getStoreAdapter().delete(keyUserInst(uid, cleanId));
    },

    async saveUserGitHubSession(session: {
      uid: string;
      githubUserId: string;
      githubLogin: string;
      accessToken: string;
      verifiedInstallationIds: string[];
    }): Promise<void> {
      const store = getStoreAdapter();
      const oauthRecord: StoredUserOAuthRecord = {
        uid: session.uid,
        githubUserId: session.githubUserId,
        githubLogin: session.githubLogin,
        accessToken: session.accessToken,
        updatedAt: new Date().toISOString(),
      };
      await store.setJSON(keyUserOAuth(session.uid), oauthRecord);
      await this.grantUserVerifiedInstallations(session.uid, session.verifiedInstallationIds);
    },

    async getUserGitHubSession(uid: string): Promise<ServerUserGitHubSession | null> {
      const store = getStoreAdapter();
      const oauth = await readJson<StoredUserOAuthRecord>(keyUserOAuth(uid));
      if (!oauth) return null;

      const list = await store.listAll(keyUserInstPrefix(uid));
      const records = await Promise.all(
        list.map((item) => readJson<StoredUserInstallationRecord>(item.key))
      );
      const verifiedInstallationIds = Array.from(
        new Set(
          records
            .filter((r): r is StoredUserInstallationRecord => Boolean(r && r.uid === uid))
            .map((r) => r.installationId)
        )
      );

      return {
        uid: oauth.uid,
        githubUserId: oauth.githubUserId,
        githubLogin: oauth.githubLogin,
        accessToken: oauth.accessToken,
        verifiedInstallationIds,
        updatedAt: oauth.updatedAt,
      };
    },

    async getUserOwnedInstallationIds(uid: string): Promise<string[]> {
      const store = getStoreAdapter();
      const [userInstList, allInstList] = await Promise.all([
        store.listAll(keyUserInstPrefix(uid)),
        store.listAll('installations/'),
      ]);

      const [userInstDocs, allInstDocs] = await Promise.all([
        Promise.all(userInstList.map((entry) => readJson<StoredUserInstallationRecord>(entry.key))),
        Promise.all(allInstList.map((entry) => readJson<ServerInstallationMapping>(entry.key))),
      ]);

      const ids = new Set<string>();
      for (const doc of userInstDocs) {
        if (doc && doc.uid === uid && doc.installationId) {
          ids.add(doc.installationId);
        }
      }
      for (const inst of allInstDocs) {
        if (inst && inst.ownerId === uid && inst.installationId) {
          ids.add(inst.installationId);
        }
      }
      return Array.from(ids);
    },

    async userOwnsInstallationOnServer(uid: string, installationId: string): Promise<boolean> {
      const cleanId = installationId.trim();
      if (!uid || !cleanId) return false;

      const [mapping, verified] = await Promise.all([
        readJson<ServerInstallationMapping>(keyInstallation(cleanId)),
        readJson<StoredUserInstallationRecord>(keyUserInst(uid, cleanId)),
      ]);

      if (mapping && mapping.ownerId === uid) {
        return true;
      }
      if (verified && verified.uid === uid) {
        return true;
      }
      return false;
    },

    async acquireWebhookDeliveryLease(
      deliveryId: string,
      options?: { leaseDurationMs?: number; nowMs?: number }
    ): Promise<WebhookDeliveryLeaseAcquireResult> {
      const cleanId = deliveryId.trim();
      if (!cleanId) {
        throw new Error('deliveryId is required to acquire webhook delivery lease.');
      }

      const store = getStoreAdapter();
      const key = keyDeliveryState(cleanId);
      const leaseMs = options?.leaseDurationMs ?? DEFAULT_WEBHOOK_LEASE_MS;
      const nowMs = options?.nowMs ?? Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const leaseExpiresAt = new Date(nowMs + leaseMs).toISOString();
      const leaseToken = crypto.randomUUID();

      const initialRecord: WebhookDeliveryStateRecord = {
        deliveryId: cleanId,
        status: 'processing',
        leaseToken,
        leaseExpiresAt,
        claimedAt: nowIso,
        attemptCount: 1,
      };

      const createRes = await store.setJSON(key, initialRecord, { onlyIfNew: true });
      if (createRes.modified) {
        return {
          status: 'acquired',
          leaseToken,
          leaseExpiresAt,
          recovered: false,
          attemptCount: 1,
        };
      }

      const existing = await store.getWithMetadata<WebhookDeliveryStateRecord>(key);
      if (!existing) {
        // Released concurrently between createRes and getWithMetadata; try one more initial create
        const retryCreate = await store.setJSON(key, initialRecord, { onlyIfNew: true });
        if (retryCreate.modified) {
          return {
            status: 'acquired',
            leaseToken,
            leaseExpiresAt,
            recovered: false,
            attemptCount: 1,
          };
        }
        const afterRetry = await store.getWithMetadata<WebhookDeliveryStateRecord>(key);
        if (afterRetry?.data.status === 'completed') {
          return { status: 'already_completed' };
        }
        return {
          status: 'in_progress',
          leaseExpiresAt: afterRetry?.data.leaseExpiresAt ?? leaseExpiresAt,
        };
      }

      if (existing.data.status === 'completed') {
        return { status: 'already_completed' };
      }

      const existingExpMs = Date.parse(existing.data.leaseExpiresAt);
      if (!Number.isNaN(existingExpMs) && existingExpMs > nowMs) {
        return {
          status: 'in_progress',
          leaseExpiresAt: existing.data.leaseExpiresAt,
        };
      }

      if (!existing.etag) {
        return {
          status: 'in_progress',
          leaseExpiresAt: existing.data.leaseExpiresAt,
        };
      }

      const nextAttempt = (existing.data.attemptCount || 1) + 1;
      const recoveryRecord: WebhookDeliveryStateRecord = {
        deliveryId: cleanId,
        status: 'processing',
        leaseToken,
        leaseExpiresAt,
        claimedAt: existing.data.claimedAt || nowIso,
        renewedAt: nowIso,
        attemptCount: nextAttempt,
      };

      const takeover = await store.setJSON(key, recoveryRecord, {
        onlyIfMatch: existing.etag,
      });

      if (takeover.modified) {
        return {
          status: 'acquired',
          leaseToken,
          leaseExpiresAt,
          recovered: true,
          attemptCount: nextAttempt,
        };
      }

      const latest = await readJson<WebhookDeliveryStateRecord>(key);
      if (latest?.status === 'completed') {
        return { status: 'already_completed' };
      }
      return {
        status: 'in_progress',
        leaseExpiresAt: latest?.leaseExpiresAt ?? leaseExpiresAt,
      };
    },

    async renewWebhookDeliveryLease(
      deliveryId: string,
      leaseToken: string,
      options?: { leaseDurationMs?: number; nowMs?: number }
    ): Promise<{ renewed: boolean; leaseExpiresAt?: string }> {
      const cleanId = deliveryId.trim();
      if (!cleanId || !leaseToken) return { renewed: false };

      const store = getStoreAdapter();
      const key = keyDeliveryState(cleanId);
      const entry = await store.getWithMetadata<WebhookDeliveryStateRecord>(key);
      if (!entry || !entry.etag) return { renewed: false };

      const nowMs = options?.nowMs ?? Date.now();
      const expMs = Date.parse(entry.data.leaseExpiresAt);
      if (
        entry.data.status !== 'processing' ||
        entry.data.leaseToken !== leaseToken ||
        Number.isNaN(expMs) ||
        expMs <= nowMs
      ) {
        return { renewed: false };
      }

      const leaseMs = options?.leaseDurationMs ?? DEFAULT_WEBHOOK_LEASE_MS;
      const nextExpiresAt = new Date(nowMs + leaseMs).toISOString();
      const updated: WebhookDeliveryStateRecord = {
        ...entry.data,
        leaseExpiresAt: nextExpiresAt,
        renewedAt: new Date(nowMs).toISOString(),
      };

      const res = await store.setJSON(key, updated, { onlyIfMatch: entry.etag });
      return res.modified
        ? { renewed: true, leaseExpiresAt: nextExpiresAt }
        : { renewed: false };
    },

    async completeWebhookDeliveryLease(
      deliveryId: string,
      leaseToken: string,
      outcome = 'processed',
      options?: { nowMs?: number }
    ): Promise<WebhookLeaseCompleteResult> {
      const cleanId = deliveryId.trim();
      if (!cleanId || !leaseToken) {
        return { completed: false, reason: 'not_found' };
      }

      const store = getStoreAdapter();
      const key = keyDeliveryState(cleanId);
      const entry = await store.getWithMetadata<WebhookDeliveryStateRecord>(key);
      if (!entry) {
        return { completed: false, reason: 'not_found' };
      }

      if (entry.data.status === 'completed') {
        return { completed: false, reason: 'already_completed' };
      }

      if (entry.data.leaseToken !== leaseToken) {
        return { completed: false, reason: 'lease_lost' };
      }

      const nowMs = options?.nowMs ?? Date.now();
      const expMs = Date.parse(entry.data.leaseExpiresAt);
      if (Number.isNaN(expMs) || expMs <= nowMs) {
        return { completed: false, reason: 'lease_expired' };
      }

      if (!entry.etag) {
        return { completed: false, reason: 'lease_lost' };
      }

      const completedRecord: WebhookDeliveryStateRecord = {
        ...entry.data,
        status: 'completed',
        completedAt: new Date(nowMs).toISOString(),
        outcome,
      };

      const res = await store.setJSON(key, completedRecord, {
        onlyIfMatch: entry.etag,
      });
      if (!res.modified) {
        const latest = await readJson<WebhookDeliveryStateRecord>(key);
        return {
          completed: false,
          reason: latest?.status === 'completed' ? 'already_completed' : 'lease_lost',
        };
      }

      return { completed: true };
    },

    async releaseWebhookDeliveryLease(
      deliveryId: string,
      leaseToken: string
    ): Promise<boolean> {
      const cleanId = deliveryId.trim();
      if (!cleanId || !leaseToken) return false;

      const store = getStoreAdapter();
      const key = keyDeliveryState(cleanId);
      const entry = await store.getWithMetadata<WebhookDeliveryStateRecord>(key);
      if (
        !entry ||
        !entry.etag ||
        entry.data.status !== 'processing' ||
        entry.data.leaseToken !== leaseToken
      ) {
        return false;
      }

      // Expire atomically with onlyIfMatch so a slow worker can never delete a newer worker's lease
      const expiredRecord: WebhookDeliveryStateRecord = {
        ...entry.data,
        leaseExpiresAt: new Date(0).toISOString(),
      };
      const res = await store.setJSON(key, expiredRecord, { onlyIfMatch: entry.etag });
      return res.modified;
    },

    async recordWebhookDelivery(record: WebhookDeliveryRecord): Promise<void> {
      const store = getStoreAdapter();
      const instId = record.installationId || 'unassigned';
      const key = keyDeliveryLog(instId, record.receivedAt, record.deliveryId);
      await store.setJSON(key, record);

      // Opportunistically prune old delivery log keys beyond cap for this installation
      const list = await store.listAll(keyDeliveriesPrefix(instId));
      if (list.length > MAX_DELIVERIES_PER_INSTALLATION) {
        const sorted = [...list].sort((a, b) => a.key.localeCompare(b.key));
        const staleKeys = sorted.slice(MAX_DELIVERIES_PER_INSTALLATION).map((item) => item.key);
        await deleteKeys(staleKeys).catch(() => {});
      }
    },

    async upsertInstallationMapping(mapping: {
      installationId: string;
      ownerId: string;
      integrationId: string;
      accountName: string;
      repositories: ServerRepositoryMapping[];
    }): Promise<void> {
      const store = getStoreAdapter();
      const instKey = keyInstallation(mapping.installationId);
      const existingInst = await store.getWithMetadata<ServerInstallationMapping>(instKey);

      if (existingInst && existingInst.data.ownerId !== mapping.ownerId) {
        throw new Error('This GitHub installation is already registered to another BuildLog account.');
      }

      const nowIso = new Date().toISOString();
      const instRecord: ServerInstallationMapping = {
        installationId: mapping.installationId,
        ownerId: mapping.ownerId,
        integrationId: mapping.integrationId,
        accountName: mapping.accountName,
        updatedAt: nowIso,
      };
      await store.setJSON(instKey, instRecord);

      const existingRepoList = await store.listAll(keyInstRepoPrefix(mapping.installationId));
      const existingRepos = await Promise.all(
        existingRepoList.map(async (entry) => ({
          key: entry.key,
          data: await readJson<ServerInstallationRepoRecord>(entry.key),
        }))
      );

      const desiredIds = new Set(mapping.repositories.map((r) => r.githubRepositoryId));

      await Promise.all(
        mapping.repositories.map(async (repo) => {
          const instRepoRecord: ServerInstallationRepoRecord = {
            ...repo,
            installationId: mapping.installationId,
            ownerId: mapping.ownerId,
            updatedAt: nowIso,
          };
          const linkRecord: RepoInstallationLinkRecord = {
            installationId: mapping.installationId,
            ownerId: mapping.ownerId,
            repositoryId: repo.repositoryId,
            githubRepositoryId: repo.githubRepositoryId,
            fullName: repo.fullName,
            status: repo.status,
            updatedAt: nowIso,
          };
          await Promise.all([
            store.setJSON(
              keyInstRepo(mapping.installationId, repo.githubRepositoryId),
              instRepoRecord
            ),
            store.setJSON(
              keyRepoInstLink(repo.githubRepositoryId, mapping.installationId),
              linkRecord
            ),
          ]);
        })
      );

      const keysToDelete: string[] = [];
      for (const item of existingRepos) {
        if (!item.data || !desiredIds.has(item.data.githubRepositoryId)) {
          keysToDelete.push(item.key);
          if (item.data?.githubRepositoryId) {
            keysToDelete.push(
              keyRepoInstLink(item.data.githubRepositoryId, mapping.installationId)
            );
          }
        }
      }
      if (keysToDelete.length > 0) {
        await deleteKeys(keysToDelete);
      }
    },

    async resolveWebhookTarget(
      installationId: string,
      githubRepositoryId: string,
      repositoryFullName: string
    ): Promise<{ ownerId: string; repositoryId: string; status: RepositoryStatus } | null> {
      const store = getStoreAdapter();
      const cleanInstId = installationId.trim();

      if (cleanInstId) {
        const inst = await readJson<ServerInstallationMapping>(keyInstallation(cleanInstId));
        if (!inst) return null;

        if (githubRepositoryId) {
          const direct = await readJson<ServerInstallationRepoRecord>(
            keyInstRepo(cleanInstId, githubRepositoryId)
          );
          if (direct && direct.ownerId === inst.ownerId) {
            return {
              ownerId: inst.ownerId,
              repositoryId: direct.repositoryId,
              status: direct.status,
            };
          }
        }

        const repoEntries = await store.listAll(keyInstRepoPrefix(cleanInstId));
        const repoDocs = await Promise.all(
          repoEntries.map((e) => readJson<ServerInstallationRepoRecord>(e.key))
        );
        const byName = repoDocs.find(
          (r) =>
            r &&
            r.ownerId === inst.ownerId &&
            r.fullName.toLowerCase() === repositoryFullName.toLowerCase()
        );
        if (byName) {
          return {
            ownerId: inst.ownerId,
            repositoryId: byName.repositoryId,
            status: byName.status,
          };
        }
        return null;
      }

      // Fallback when installationId is absent: use per-installation repo-inst-link keys
      // and fail closed if multiple distinct owners reference the same repository.
      if (!githubRepositoryId) return null;

      const linkEntries = await store.listAll(keyRepoInstLinkPrefix(githubRepositoryId));
      if (linkEntries.length === 0) return null;

      const links = await Promise.all(
        linkEntries.map((e) => readJson<RepoInstallationLinkRecord>(e.key))
      );

      const verifiedMatches: Array<{
        ownerId: string;
        repositoryId: string;
        status: RepositoryStatus;
      }> = [];

      for (const link of links) {
        if (!link) continue;
        const inst = await readJson<ServerInstallationMapping>(keyInstallation(link.installationId));
        if (!inst || inst.ownerId !== link.ownerId) continue;
        verifiedMatches.push({
          ownerId: link.ownerId,
          repositoryId: link.repositoryId,
          status: link.status,
        });
      }

      if (verifiedMatches.length === 0) return null;

      const distinctOwners = new Set(verifiedMatches.map((m) => m.ownerId));
      if (distinctOwners.size > 1) {
        // Ambiguous cross-user routing without installationId -> fail closed
        return null;
      }

      const activeMatch = verifiedMatches.find((m) => m.status === 'active');
      return activeMatch ?? verifiedMatches[0];
    },

    async enqueuePendingWebhookEvents(events: PendingWebhookEvent[]): Promise<number> {
      if (events.length === 0) return 0;
      const store = getStoreAdapter();

      const results = await Promise.all(
        events.map((ev) =>
          store.setJSON(keyPendingEvent(ev.ownerId, ev.queueId), ev, { onlyIfNew: true })
        )
      );

      return results.filter((r) => r.modified).length;
    },

    async getPendingEventsAndDeliveriesForUser(ownerId: string): Promise<{
      pendingEvents: PendingWebhookEvent[];
      recentDeliveries: WebhookDeliveryRecord[];
    }> {
      const store = getStoreAdapter();

      const [pendingKeys, allInstList] = await Promise.all([
        store.listAll(keyPendingPrefix(ownerId)),
        store.listAll('installations/'),
      ]);

      const [pendingDocs, instDocs] = await Promise.all([
        Promise.all(pendingKeys.map((item) => readJson<PendingWebhookEvent>(item.key))),
        Promise.all(allInstList.map((item) => readJson<ServerInstallationMapping>(item.key))),
      ]);

      const pendingEvents = pendingDocs
        .filter((ev): ev is PendingWebhookEvent => Boolean(ev && ev.ownerId === ownerId))
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

      const ownedInstIds = Array.from(
        new Set(
          instDocs
            .filter((inst): inst is ServerInstallationMapping => Boolean(inst && inst.ownerId === ownerId))
            .map((inst) => inst.installationId)
        )
      );

      const deliveryKeyGroups = await Promise.all(
        ownedInstIds.map((instId) => store.listAll(keyDeliveriesPrefix(instId)))
      );

      const candidateKeys = deliveryKeyGroups
        .flat()
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, 30);

      const deliveryDocs = await Promise.all(
        candidateKeys.map((entry) => readJson<WebhookDeliveryRecord>(entry.key))
      );

      const recentDeliveries = deliveryDocs
        .filter((d): d is WebhookDeliveryRecord => Boolean(d))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
        .slice(0, 30);

      return { pendingEvents, recentDeliveries };
    },

    async acknowledgePendingEvents(ownerId: string, queueIds: string[]): Promise<number> {
      const uniqueIds = Array.from(new Set(queueIds.map((id) => id.trim()).filter(Boolean)));
      if (uniqueIds.length === 0) return 0;

      const store = getStoreAdapter();
      let acknowledged = 0;

      await Promise.all(
        uniqueIds.map(async (queueId) => {
          const key = keyPendingEvent(ownerId, queueId);
          const existing = await readJson<PendingWebhookEvent>(key);
          if (existing && existing.ownerId === ownerId) {
            await store.delete(key);
            acknowledged += 1;
          }
        })
      );

      return acknowledged;
    },

    async removeInstallationMapping(ownerId: string, installationId: string): Promise<void> {
      const cleanInstId = installationId.trim();
      if (!ownerId || !cleanInstId) return;

      const store = getStoreAdapter();
      const instKey = keyInstallation(cleanInstId);
      const existing = await readJson<ServerInstallationMapping>(instKey);

      if (existing && existing.ownerId !== ownerId) {
        return;
      }

      // Revoke primary installation ownership & user-inst link first so routing stops immediately
      await Promise.all([
        existing ? store.delete(instKey) : Promise.resolve(),
        store.delete(keyUserInst(ownerId, cleanInstId)),
      ]);

      const [instRepoList, pendingList] = await Promise.all([
        store.listAll(keyInstRepoPrefix(cleanInstId)),
        store.listAll(keyPendingPrefix(ownerId)),
      ]);

      const instRepoDocs = await Promise.all(
        instRepoList.map(async (entry) => ({
          key: entry.key,
          data: await readJson<ServerInstallationRepoRecord>(entry.key),
        }))
      );

      const removedRepoIds = new Set<string>();
      const keysToDelete: string[] = [];

      for (const item of instRepoDocs) {
        keysToDelete.push(item.key);
        if (item.data) {
          removedRepoIds.add(item.data.repositoryId);
          keysToDelete.push(keyRepoInstLink(item.data.githubRepositoryId, cleanInstId));
        }
      }

      if (removedRepoIds.size > 0) {
        const pendingDocs = await Promise.all(
          pendingList.map(async (entry) => ({
            key: entry.key,
            data: await readJson<PendingWebhookEvent>(entry.key),
          }))
        );
        for (const item of pendingDocs) {
          if (item.data && item.data.ownerId === ownerId && removedRepoIds.has(item.data.repositoryId)) {
            keysToDelete.push(item.key);
          }
        }
      }

      if (keysToDelete.length > 0) {
        await deleteKeys(keysToDelete);
      }
    },

    async purgeOwnerServerState(ownerId: string): Promise<void> {
      if (!ownerId) return;
      const store = getStoreAdapter();

      // 1. Enumerate owned installations first
      const [userInstList, allInstList] = await Promise.all([
        store.listAll(keyUserInstPrefix(ownerId)),
        store.listAll('installations/'),
      ]);

      const allInstDocs = await Promise.all(
        allInstList.map(async (entry) => ({
          key: entry.key,
          data: await readJson<ServerInstallationMapping>(entry.key),
        }))
      );

      const ownedInstallations = allInstDocs.filter(
        (item): item is { key: string; data: ServerInstallationMapping } =>
          Boolean(item.data && item.data.ownerId === ownerId)
      );

      // 2. Immediately revoke OAuth session + installation ownership keys first
      await Promise.all([
        store.delete(keyUserOAuth(ownerId)),
        ...ownedInstallations.map((item) => store.delete(item.key)),
        ...userInstList.map((item) => store.delete(item.key)),
      ]);

      // 3. Idempotently delete remaining installation repos, repo links, deliveries, pending events, and auth states
      const keysToDelete: string[] = [];

      const [pendingList, authStateList, ...instCleanupGroups] = await Promise.all([
        store.listAll(keyPendingPrefix(ownerId)),
        store.listAll('auth-state/'),
        ...ownedInstallations.map(async (item) => {
          const instId = item.data.installationId;
          const [repoKeys, deliveryKeys] = await Promise.all([
            store.listAll(keyInstRepoPrefix(instId)),
            store.listAll(keyDeliveriesPrefix(instId)),
          ]);
          const repoDocs = await Promise.all(
            repoKeys.map((rk) => readJson<ServerInstallationRepoRecord>(rk.key))
          );
          const linkKeys = repoDocs
            .filter((r): r is ServerInstallationRepoRecord => Boolean(r))
            .map((r) => keyRepoInstLink(r.githubRepositoryId, instId));
          return [
            ...repoKeys.map((k) => k.key),
            ...deliveryKeys.map((k) => k.key),
            ...linkKeys,
          ];
        }),
      ]);

      for (const p of pendingList) {
        keysToDelete.push(p.key);
      }

      for (const group of instCleanupGroups) {
        keysToDelete.push(...group);
      }

      const authDocs = await Promise.all(
        authStateList.map(async (entry) => ({
          key: entry.key,
          data: await readJson<PendingGitHubAuthState>(entry.key),
        }))
      );
      for (const item of authDocs) {
        if (item.data && item.data.uid === ownerId) {
          keysToDelete.push(item.key);
        }
      }

      if (keysToDelete.length > 0) {
        await deleteKeys(Array.from(new Set(keysToDelete)));
      }
    },
  };
}

const defaultStore = createWebhookStore();

export const createPendingAuthState = defaultStore.createPendingAuthState.bind(defaultStore);
export const consumePendingAuthState = defaultStore.consumePendingAuthState.bind(defaultStore);
export const grantUserVerifiedInstallations =
  defaultStore.grantUserVerifiedInstallations.bind(defaultStore);
export const revokeUserVerifiedInstallation =
  defaultStore.revokeUserVerifiedInstallation.bind(defaultStore);
export const saveUserGitHubSession = defaultStore.saveUserGitHubSession.bind(defaultStore);
export const getUserGitHubSession = defaultStore.getUserGitHubSession.bind(defaultStore);
export const getUserOwnedInstallationIds =
  defaultStore.getUserOwnedInstallationIds.bind(defaultStore);
export const userOwnsInstallationOnServer =
  defaultStore.userOwnsInstallationOnServer.bind(defaultStore);
export const acquireWebhookDeliveryLease =
  defaultStore.acquireWebhookDeliveryLease.bind(defaultStore);
export const renewWebhookDeliveryLease =
  defaultStore.renewWebhookDeliveryLease.bind(defaultStore);
export const completeWebhookDeliveryLease =
  defaultStore.completeWebhookDeliveryLease.bind(defaultStore);
export const releaseWebhookDeliveryLease =
  defaultStore.releaseWebhookDeliveryLease.bind(defaultStore);
export const recordWebhookDelivery = defaultStore.recordWebhookDelivery.bind(defaultStore);
export const upsertInstallationMapping =
  defaultStore.upsertInstallationMapping.bind(defaultStore);
export const resolveWebhookTarget = defaultStore.resolveWebhookTarget.bind(defaultStore);
export const enqueuePendingWebhookEvents =
  defaultStore.enqueuePendingWebhookEvents.bind(defaultStore);
export const getPendingEventsAndDeliveriesForUser =
  defaultStore.getPendingEventsAndDeliveriesForUser.bind(defaultStore);
export const acknowledgePendingEvents = defaultStore.acknowledgePendingEvents.bind(defaultStore);
export const removeInstallationMapping =
  defaultStore.removeInstallationMapping.bind(defaultStore);
export const purgeOwnerServerState = defaultStore.purgeOwnerServerState.bind(defaultStore);
