import crypto from 'node:crypto';
import type {
  GitHubAppConfigStatus,
  NormalizedGitHubEventPayload,
  RemoteGitHubRepository,
} from '../types/models';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Normalises a PEM private key pasted into an environment variable. Hosting dashboards often
 * mangle multi-line values, so this accepts: real newlines, literal "\n" escapes, CRLF line
 * endings, surrounding quotes, line breaks collapsed into spaces, and a base64-encoded .pem file.
 */
export function normalizePrivateKeyPem(input: string): string {
  let key = input.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');

  // Whole .pem file supplied as base64 (no BEGIN header).
  if (key && !key.includes('-----BEGIN')) {
    const decoded = Buffer.from(key.replace(/\s+/g, ''), 'base64').toString('utf8');
    if (decoded.includes('-----BEGIN')) key = decoded.trim();
  }

  // Rebuild the PEM so whitespace inside the body (e.g. spaces instead of newlines) doesn't matter.
  const match = key.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) return key;
  const label = match[1];
  const body = match[2].replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

function readPrivateKey(): string {
  return normalizePrivateKeyPem(process.env.GITHUB_APP_PRIVATE_KEY ?? '');
}

function loadSigningKey(pem: string): crypto.KeyObject {
  try {
    return crypto.createPrivateKey(pem);
  } catch {
    throw new Error(
      'GITHUB_APP_PRIVATE_KEY is not a valid private key. Open the .pem file downloaded from your GitHub App, copy everything including the -----BEGIN and -----END lines, paste it as the value in your Vercel project settings, and redeploy.'
    );
  }
}

export function getGitHubAppConfigStatus(): GitHubAppConfigStatus {
  const appId = (process.env.GITHUB_APP_ID ?? '').trim();
  const privateKey = readPrivateKey().trim();
  const clientId = (process.env.GITHUB_APP_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GITHUB_APP_CLIENT_SECRET ?? '').trim();
  const webhookSecret = (process.env.GITHUB_WEBHOOK_SECRET ?? '').trim();
  const appSlug = (process.env.GITHUB_APP_SLUG ?? '').trim() || null;
  const geminiKey = (process.env.GEMINI_API_KEY ?? '').trim();

  const missingEnvVars: string[] = [];
  if (!appId) missingEnvVars.push('GITHUB_APP_ID');
  if (!appSlug) missingEnvVars.push('GITHUB_APP_SLUG');
  if (!clientId) missingEnvVars.push('GITHUB_APP_CLIENT_ID');
  if (!clientSecret) missingEnvVars.push('GITHUB_APP_CLIENT_SECRET');
  if (!privateKey) missingEnvVars.push('GITHUB_APP_PRIVATE_KEY');
  if (!webhookSecret) missingEnvVars.push('GITHUB_WEBHOOK_SECRET');

  const configured = Boolean(appId && privateKey && appSlug);
  const oauthConfigured = Boolean(clientId && clientSecret);
  const webhookConfigured = Boolean(webhookSecret);
  const geminiConfigured = Boolean(geminiKey && geminiKey !== 'MY_GEMINI_API_KEY');

  return {
    configured,
    oauthConfigured,
    webhookConfigured,
    geminiConfigured,
    appSlug,
    installUrl: configured && appSlug ? `https://github.com/apps/${appSlug}/installations/new` : null,
    webhookPath: '/api/webhooks/github',
    missingEnvVars,
  };
}

export function buildGitHubAppInstallUrl(stateToken: string): string {
  const appSlug = (process.env.GITHUB_APP_SLUG ?? '').trim();
  if (!appSlug) {
    throw new Error('GITHUB_APP_SLUG is not configured on the server.');
  }
  return `https://github.com/apps/${encodeURIComponent(
    appSlug
  )}/installations/new?state=${encodeURIComponent(stateToken)}`;
}

export function buildGitHubOAuthAuthorizeUrl(stateToken: string, redirectUri: string): string {
  const clientId = (process.env.GITHUB_APP_CLIENT_ID ?? '').trim();
  if (!clientId) {
    throw new Error('GITHUB_APP_CLIENT_ID is not configured on the server.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state: stateToken,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export async function exchangeGitHubOAuthCode(
  code: string,
  redirectUri?: string
): Promise<string> {
  const clientId = (process.env.GITHUB_APP_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GITHUB_APP_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'GitHub App OAuth credentials are not configured on the server (GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET required).'
    );
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'BuildLog-App',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub OAuth token exchange failed (${res.status}).`);
  }

  const data = (await res.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(
      data.error_description || data.error || 'GitHub did not return an authorization token.'
    );
  }
  return data.access_token;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createGitHubAppJwt(): string {
  const appId = (process.env.GITHUB_APP_ID ?? '').trim();
  const privateKey = readPrivateKey().trim();

  if (!appId || !privateKey) {
    throw new Error(
      'GitHub App credentials are not configured on the server (GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY required).'
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iat: now - 60,
      exp: now + 540,
      iss: appId,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(loadSigningKey(privateKey));

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

async function githubFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'BuildLog-App',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`GitHub API error (${res.status}): ${bodyText.slice(0, 240)}`);
  }

  return (await res.json()) as T;
}

export async function fetchAuthorizedGitHubUserAndInstallations(userAccessToken: string): Promise<{
  githubUserId: string;
  githubLogin: string;
  installationIds: string[];
}> {
  const headers = {
    Authorization: `Bearer ${userAccessToken}`,
  };

  const user = await githubFetch<{ id: number; login: string }>(`${GITHUB_API_BASE}/user`, {
    headers,
  });

  const userInstalls = await githubFetch<{
    installations?: Array<{ id: number }>;
  }>(`${GITHUB_API_BASE}/user/installations?per_page=100`, {
    headers,
  });

  return {
    githubUserId: String(user.id),
    githubLogin: user.login,
    installationIds: (userInstalls.installations ?? []).map((inst) => String(inst.id)),
  };
}

export async function verifyAndAuthorizeInstallation(installationId: string): Promise<{
  installationId: string;
  accountName: string;
  token: string;
  repositories: RemoteGitHubRepository[];
}> {
  const appJwt = createGitHubAppJwt();

  const installation = await githubFetch<{
    id: number;
    account?: { login?: string };
    permissions?: Record<string, string>;
  }>(`${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}`, {
    headers: {
      Authorization: `Bearer ${appJwt}`,
    },
  });

  const tokenData = await githubFetch<{ token: string }>(
    `${GITHUB_API_BASE}/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
      },
    }
  );

  const repoList = await githubFetch<{
    repositories?: Array<{
      id: number;
      full_name: string;
      description?: string | null;
      default_branch?: string;
      language?: string | null;
      html_url?: string;
      private?: boolean;
    }>;
  }>(`${GITHUB_API_BASE}/installation/repositories?per_page=100`, {
    headers: {
      Authorization: `Bearer ${tokenData.token}`,
    },
  });

  const repositories: RemoteGitHubRepository[] = (repoList.repositories ?? []).map((r) => ({
    githubRepositoryId: String(r.id),
    fullName: r.full_name,
    description: (r.description ?? '').slice(0, 1000),
    defaultBranch: r.default_branch || 'main',
    primaryLanguage: r.language || '',
    htmlUrl: r.html_url || `https://github.com/${r.full_name}`,
    private: Boolean(r.private),
  }));

  return {
    installationId: String(installation.id),
    accountName: installation.account?.login || `installation-${installation.id}`,
    token: tokenData.token,
    repositories,
  };
}

export async function verifyInstallationContainsRepository(
  installationId: string,
  targetFullName: string
): Promise<{
  found: true;
  installationId: string;
  accountName: string;
  repository: RemoteGitHubRepository;
} | {
  found: false;
  installationId: string;
  accountName: string;
}> {
  const result = await verifyAndAuthorizeInstallation(installationId);
  const match = result.repositories.find(
    (repo) => repo.fullName.toLowerCase() === targetFullName.toLowerCase()
  );
  if (!match) {
    return {
      found: false,
      installationId: result.installationId,
      accountName: result.accountName,
    };
  }
  return {
    found: true,
    installationId: result.installationId,
    accountName: result.accountName,
    repository: match,
  };
}

export async function fetchRepositoryRecentHistory(
  installationId: string,
  fullName: string,
  defaultBranch: string
): Promise<NormalizedGitHubEventPayload[]> {
  const { token } = await verifyAndAuthorizeInstallation(installationId);
  const headers = { Authorization: `Bearer ${token}` };
  const events: NormalizedGitHubEventPayload[] = [];

  // 1. Recent commits on default branch
  const commits = await githubFetch<
    Array<{
      sha: string;
      html_url?: string;
      commit?: {
        message?: string;
        author?: { name?: string; date?: string };
      };
      author?: { login?: string } | null;
    }>
  >(
    `${GITHUB_API_BASE}/repos/${fullName}/commits?sha=${encodeURIComponent(
      defaultBranch
    )}&per_page=12`,
    { headers }
  ).catch(() => []);

  // Fetch file list for up to 8 most recent commits (read-only metadata)
  for (let i = 0; i < commits.length; i += 1) {
    const c = commits[i];
    const message = c.commit?.message || `Commit ${c.sha.slice(0, 7)}`;
    const firstLine = message.split('\n')[0] || `Commit ${c.sha.slice(0, 7)}`;
    let changedFiles: string[] = [];

    if (i < 8) {
      const detail = await githubFetch<{
        files?: Array<{ filename?: string }>;
      }>(`${GITHUB_API_BASE}/repos/${fullName}/commits/${c.sha}`, { headers }).catch(() => null);
      if (detail?.files) {
        changedFiles = detail.files
          .map((f) => f.filename || '')
          .filter(Boolean)
          .slice(0, 100);
      }
    }

    events.push({
      eventId: `push:${c.sha}`,
      eventType: 'push',
      branch: defaultBranch,
      commitSha: c.sha,
      title: firstLine.slice(0, 300),
      description: message.slice(0, 5000),
      sourceUrl: c.html_url || `https://github.com/${fullName}/commit/${c.sha}`,
      changedFiles,
      occurredAt: c.commit?.author?.date || new Date().toISOString(),
      author: c.author?.login || c.commit?.author?.name || 'unknown',
    });
  }

  // 2. Recent Pull Requests
  const pulls = await githubFetch<
    Array<{
      number: number;
      title: string;
      body?: string | null;
      state: string;
      merged_at?: string | null;
      html_url: string;
      updated_at: string;
      user?: { login?: string } | null;
      head?: { ref?: string; sha?: string };
    }>
  >(`${GITHUB_API_BASE}/repos/${fullName}/pulls?state=all&sort=updated&direction=desc&per_page=10`, {
    headers,
  }).catch(() => []);

  for (const pr of pulls) {
    const state = pr.merged_at ? 'merged' : pr.state;
    events.push({
      eventId: `pr:${fullName}:${pr.number}:import`,
      eventType: 'pull_request',
      branch: pr.head?.ref || defaultBranch,
      commitSha: pr.head?.sha || '',
      title: `[PR #${pr.number} ${state}] ${pr.title}`.slice(0, 300),
      description: (pr.body ?? '').slice(0, 5000),
      sourceUrl: pr.html_url,
      changedFiles: [],
      occurredAt: pr.updated_at || new Date().toISOString(),
      author: pr.user?.login || 'unknown',
      prNumber: pr.number,
      prState: state,
    });
  }

  // 3. Recent Issues (excluding PRs)
  const issues = await githubFetch<
    Array<{
      number: number;
      title: string;
      body?: string | null;
      state: string;
      html_url: string;
      updated_at: string;
      user?: { login?: string } | null;
      pull_request?: unknown;
    }>
  >(`${GITHUB_API_BASE}/repos/${fullName}/issues?state=all&sort=updated&direction=desc&per_page=15`, {
    headers,
  }).catch(() => []);

  for (const issue of issues) {
    if (issue.pull_request) continue;
    events.push({
      eventId: `issue:${fullName}:${issue.number}:import`,
      eventType: 'issues',
      branch: defaultBranch,
      commitSha: '',
      title: `[Issue #${issue.number} ${issue.state}] ${issue.title}`.slice(0, 300),
      description: (issue.body ?? '').slice(0, 5000),
      sourceUrl: issue.html_url,
      changedFiles: [],
      occurredAt: issue.updated_at || new Date().toISOString(),
      author: issue.user?.login || 'unknown',
      issueNumber: issue.number,
      issueState: issue.state,
    });
  }

  return events.sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
  );
}
