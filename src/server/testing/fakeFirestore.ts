import type {
  StateCollection,
  StateDocRef,
  StateDocSnapshot,
  StateQuery,
  StateQuerySnapshot,
  TimestampLike,
} from '../firestoreStateStore';

/**
 * Minimal in-memory stand-in for the parts of firebase-admin Firestore used by
 * firestoreStateStore. It mirrors Firestore's semantics that the store relies on:
 * - create() fails with ALREADY_EXISTS (code 6) if the document exists
 * - update() fails with NOT_FOUND (5) if missing and FAILED_PRECONDITION (9) when the
 *   lastUpdateTime precondition doesn't match
 * - every write gets a strictly increasing update time
 * Each operation yields to the event loop first so concurrent calls interleave like real I/O.
 * Test-only; never imported by application code.
 */

interface StoredDoc {
  data: Record<string, unknown>;
  updateTime: TimestampLike;
}

function firestoreError(code: number, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function sameTime(a: TimestampLike, b: unknown): boolean {
  const other = b as TimestampLike | null;
  return Boolean(other) && a.seconds === other!.seconds && a.nanoseconds === other!.nanoseconds;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

export class FakeFirestore {
  private collections = new Map<string, Map<string, StoredDoc>>();
  private clock = { seconds: 1_800_000_000, nanoseconds: 0 };

  private nextTime(): TimestampLike {
    this.clock.nanoseconds += 1000;
    if (this.clock.nanoseconds >= 1_000_000_000) {
      this.clock.seconds += 1;
      this.clock.nanoseconds = 0;
    }
    return { ...this.clock };
  }

  static timestamp(seconds: number, nanoseconds: number): TimestampLike {
    return { seconds, nanoseconds };
  }

  collection(name: string): StateCollection {
    if (!this.collections.has(name)) this.collections.set(name, new Map());
    const docs = this.collections.get(name)!;
    const db = this;

    const snapshotOf = (stored: StoredDoc | undefined): StateDocSnapshot => ({
      exists: Boolean(stored),
      updateTime: stored?.updateTime,
      get: (field: string) => stored?.data[field],
    });

    const docRef = (id: string): StateDocRef => ({
      async get() {
        await tick();
        const stored = docs.get(id);
        return snapshotOf(stored ? { data: { ...stored.data }, updateTime: stored.updateTime } : undefined);
      },
      async create(data) {
        await tick();
        if (docs.has(id)) throw firestoreError(6, 'ALREADY_EXISTS');
        const updateTime = db.nextTime();
        docs.set(id, { data: { ...data }, updateTime });
        return { writeTime: updateTime };
      },
      async set(data) {
        await tick();
        const updateTime = db.nextTime();
        docs.set(id, { data: { ...data }, updateTime });
        return { writeTime: updateTime };
      },
      async update(data, precondition) {
        await tick();
        const current = docs.get(id);
        if (!current) throw firestoreError(5, 'NOT_FOUND');
        if (precondition && !sameTime(current.updateTime, precondition.lastUpdateTime)) {
          throw firestoreError(9, 'FAILED_PRECONDITION');
        }
        const updateTime = db.nextTime();
        docs.set(id, { data: { ...current.data, ...data }, updateTime });
        return { writeTime: updateTime };
      },
      async delete() {
        await tick();
        docs.delete(id);
      },
    });

    const makeQuery = (filters: Array<{ field: string; op: '>=' | '<'; value: string }>): StateQuery => ({
      where(field, op, value) {
        return makeQuery([...filters, { field, op, value }]);
      },
      select() {
        return makeQuery(filters);
      },
      async get(): Promise<StateQuerySnapshot> {
        await tick();
        const matches = [...docs.values()].filter((doc) =>
          filters.every(({ field, op, value }) => {
            const v = String(doc.data[field] ?? '');
            return op === '>=' ? v >= value : v < value;
          })
        );
        return {
          docs: matches.map((doc) => ({
            updateTime: doc.updateTime,
            get: (field: string) => doc.data[field],
          })),
        };
      },
    });

    return {
      doc: docRef,
      where(field, op, value) {
        return makeQuery([{ field, op, value }]);
      },
    };
  }

  documentCount(collection: string): number {
    return this.collections.get(collection)?.size ?? 0;
  }
}
