export type ParsedGitHubRepoResult =
  | {
      valid: true;
      owner: string;
      repo: string;
      fullName: string;
      canonicalUrl: string;
    }
  | {
      valid: false;
      error: string;
    };

const OWNER_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;
const REPO_PATTERN = /^[a-zA-Z0-9._-]{1,100}$/;

export function parseGitHubRepositoryUrl(rawInput: string): ParsedGitHubRepoResult {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return { valid: false, error: 'Paste the link to your project on GitHub.' };
  }

  // Handle git@github.com:owner/repo.git
  const sshMatch = /^git@github\.com:([^/\s]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    const owner = sshMatch[1];
    const repo = sshMatch[2].replace(/\.git$/i, '');
    return validateOwnerAndRepo(owner, repo);
  }

  let candidate = trimmed;
  if (/^(?:www\.)?github\.com\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return {
      valid: false,
      error: "That doesn't look like a GitHub project link. It should look like https://github.com/your-name/your-project.",
    };
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') {
    return {
      valid: false,
      error: 'Only links to github.com projects are supported.',
    };
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    return {
      valid: false,
      error: 'The link needs both the owner and the project name, like https://github.com/your-name/your-project.',
    };
  }

  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  return validateOwnerAndRepo(owner, repo);
}

function validateOwnerAndRepo(owner: string, repo: string): ParsedGitHubRepoResult {
  if (!OWNER_PATTERN.test(owner)) {
    return {
      valid: false,
      error: "The owner name in that link doesn't look right.",
    };
  }

  if (!REPO_PATTERN.test(repo) || repo === '.' || repo === '..') {
    return {
      valid: false,
      error: "The project name in that link doesn't look right.",
    };
  }

  const fullName = `${owner}/${repo}`;
  return {
    valid: true,
    owner,
    repo,
    fullName,
    canonicalUrl: `https://github.com/${fullName}`,
  };
}
