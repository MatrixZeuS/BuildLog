import type {
  BlobEntryWithMetadata,
  BlobListEntry,
  BlobStoreAdapter,
  BlobWriteResult,
} from './webhookStore';

/**
 * Server-side state store backed by Cloud Firestore (via firebase-admin).
 *
 * Implements the same BlobStoreAdapter contract the webhook store was built on:
 * - get returns the value plus an etag (the document's update time)
 * - setJSON supports atomic `onlyIfNew` (create) and `onlyIfMatch` (update with a
 *   last-update-time precondition), which the delivery leases and one-time OAuth
 *   states depend on
 * - listAll returns keys under a prefix
 *
 * Each key is stored as one document in a server-only collection. Client SDK access to
 * that collection is denied by firestore.rules (default deny); firebase-admin bypasses rules.
 *
 * The Firestore surface used here is described with small structural types so the adapter
 * can be exercised in tests with an in-memory fake.
 */

export interface TimestampLike {
  seconds: number;
  nanoseconds: number;
}

export interface StateWriteResult {
  writeTime: TimestampLike;
}

export interface StateDocSnapshot {
  exists: boolean;
  updateTime?: TimestampLike;
  get(field: string): unknown;
}

export interface StateDocRef {
  get(): Promise<StateDocSnapshot>;
  create(data: Record<string, unknown>): Promise<StateWriteResult>;
  set(data: Record<string, unknown>): Promise<StateWriteResult>;
  update(
    data: Record<string, unknown>,
    precondition: { lastUpdateTime: unknown }
  ): Promise<StateWriteResult>;
  delete(): Promise<unknown>;
}

export interface StateQuerySnapshot {
  docs: Array<{ updateTime: TimestampLike; get(field: string): unknown }>;
}

export interface StateQuery {
  where(field: string, op: '>=' | '<', value: string): StateQuery;
  select(...fields: string[]): StateQuery;
  get(): Promise<StateQuerySnapshot>;
}

export interface StateCollection {
  doc(id: string): StateDocRef;
  where(field: string, op: '>=' | '<', value: string): StateQuery;
}

/** gRPC status codes returned by Firestore. */
const ALREADY_EXISTS = 6;
const NOT_FOUND = 5;
const FAILED_PRECONDITION = 9;

function errorCode(error: unknown): number | string | undefined {
  return (error as { code?: number | string } | null)?.code;
}

function isCode(error: unknown, numeric: number, named: string): boolean {
  const code = errorCode(error);
  return code === numeric || code === named || code === `${numeric}`;
}

/** Keys contain "/", which Firestore document IDs can't, so IDs are base64url-encoded keys. */
export function encodeStateDocId(key: string): string {
  return Buffer.from(key, 'utf8').toString('base64url');
}

export function timestampToEtag(ts: TimestampLike | undefined): string | undefined {
  if (!ts) return undefined;
  return `${ts.seconds}.${String(ts.nanoseconds).padStart(9, '0')}`;
}

export function etagToTimestampParts(etag: string): TimestampLike | null {
  const match = /^(-?\d+)\.(\d{9})$/.exec(etag.trim());
  if (!match) return null;
  return { seconds: Number(match[1]), nanoseconds: Number(match[2]) };
}

export function createFirestoreStateStoreAdapter(
  collection: StateCollection,
  makeTimestamp: (seconds: number, nanoseconds: number) => unknown
): BlobStoreAdapter {
  return {
    async getWithMetadata<T = unknown>(key: string): Promise<BlobEntryWithMetadata<T> | null> {
      const snap = await collection.doc(encodeStateDocId(key)).get();
      if (!snap.exists) return null;
      const raw = snap.get('json');
      if (typeof raw !== 'string') return null;
      return {
        data: JSON.parse(raw) as T,
        etag: timestampToEtag(snap.updateTime),
      };
    },

    async setJSON(
      key: string,
      data: unknown,
      options?: { onlyIfNew?: boolean } | { onlyIfMatch?: string }
    ): Promise<BlobWriteResult> {
      const ref = collection.doc(encodeStateDocId(key));
      const payload = { key, json: JSON.stringify(data ?? null) };

      if (options && 'onlyIfNew' in options && options.onlyIfNew) {
        try {
          const result = await ref.create(payload);
          return { etag: timestampToEtag(result.writeTime), modified: true };
        } catch (error) {
          if (isCode(error, ALREADY_EXISTS, 'already-exists')) return { modified: false };
          throw error;
        }
      }

      if (options && 'onlyIfMatch' in options && options.onlyIfMatch !== undefined) {
        const parts = etagToTimestampParts(options.onlyIfMatch);
        if (!parts) return { modified: false };
        try {
          const result = await ref.update(payload, {
            lastUpdateTime: makeTimestamp(parts.seconds, parts.nanoseconds),
          });
          return { etag: timestampToEtag(result.writeTime), modified: true };
        } catch (error) {
          if (
            isCode(error, FAILED_PRECONDITION, 'failed-precondition') ||
            isCode(error, NOT_FOUND, 'not-found')
          ) {
            return { modified: false };
          }
          throw error;
        }
      }

      const result = await ref.set(payload);
      return { etag: timestampToEtag(result.writeTime), modified: true };
    },

    async delete(key: string): Promise<void> {
      await collection.doc(encodeStateDocId(key)).delete();
    },

    async listAll(prefix: string): Promise<BlobListEntry[]> {
      const snap = await collection
        .where('key', '>=', prefix)
        .where('key', '<', `${prefix}`)
        .select('key')
        .get();
      return snap.docs
        .map((doc) => ({
          key: String(doc.get('key') ?? ''),
          etag: timestampToEtag(doc.updateTime) ?? '',
        }))
        .filter((entry) => entry.key.startsWith(prefix))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
  };
}
