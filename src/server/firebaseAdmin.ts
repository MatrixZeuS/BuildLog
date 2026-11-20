import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { initializeFirestore, type Firestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

/**
 * Shared firebase-admin app for the server.
 *
 * - Verifying sign-in tokens only needs the project ID.
 * - Reading/writing Firestore from the server (server-side state store) needs a service
 *   account, supplied via the FIREBASE_SERVICE_ACCOUNT environment variable as either the raw
 *   JSON of the downloaded key file or that JSON base64-encoded.
 */

interface ServiceAccountJson {
  project_id?: string;
  client_email?: string;
  private_key?: string;
}

export function parseServiceAccount(raw: string | undefined): ServiceAccountJson | null {
  const value = (raw ?? '').trim();
  if (!value) return null;

  const candidates = [value];
  if (!value.startsWith('{')) {
    try {
      candidates.push(Buffer.from(value, 'base64').toString('utf8').trim());
    } catch {
      // not base64
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as ServiceAccountJson;
      if (parsed && parsed.client_email && parsed.private_key) {
        return {
          ...parsed,
          // Dashboards sometimes keep "\n" escaped inside the key.
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
        };
      }
    } catch {
      // try next candidate
    }
  }

  throw new Error(
    'FIREBASE_SERVICE_ACCOUNT is not valid. Paste the full contents of the service account .json file you downloaded from Firebase.'
  );
}

export function getFirebaseProjectId(): string {
  return (
    (firebaseConfig as { projectId?: string }).projectId ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  );
}

export function getFirestoreDatabaseId(): string {
  return (
    process.env.FIRESTORE_DATABASE_ID ||
    (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId ||
    '(default)'
  );
}

export function hasServiceAccount(): boolean {
  return Boolean((process.env.FIREBASE_SERVICE_ACCOUNT ?? '').trim());
}

let cachedApp: App | null = null;

export function getAdminApp(): App {
  if (cachedApp) return cachedApp;
  const existing = getApps()[0];
  if (existing) {
    cachedApp = existing;
    return existing;
  }

  const serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
  const projectId = getFirebaseProjectId() || serviceAccount?.project_id || undefined;

  cachedApp = initializeApp({
    projectId,
    ...(serviceAccount
      ? {
          credential: cert({
            projectId: serviceAccount.project_id || projectId,
            clientEmail: serviceAccount.client_email,
            privateKey: serviceAccount.private_key,
          }),
        }
      : {}),
  });
  return cachedApp;
}

let cachedFirestore: Firestore | null = null;

export function getServerFirestore(): Firestore {
  if (cachedFirestore) return cachedFirestore;
  if (!hasServiceAccount()) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT is not set, so the server cannot save its data. Add it in your Vercel project settings and redeploy.'
    );
  }
  const databaseId = getFirestoreDatabaseId();
  // REST transport: faster cold starts and no long-lived gRPC connections on serverless hosts.
  const settings = { preferRest: true };
  cachedFirestore =
    databaseId === '(default)'
      ? initializeFirestore(getAdminApp(), settings)
      : initializeFirestore(getAdminApp(), settings, databaseId);
  return cachedFirestore;
}
