const GITHUB_API = "https://api.github.com";

/** Extracts "owner/repo" from a repo URL like https://github.com/vercel/next.js */
export function parseRepoUrl(repoUrl: string): string | null {
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
      return null;
    }
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return null;
    return `${owner}/${repo.replace(/\.git$/, "")}`;
  } catch {
    return null;
  }
}

/** Headers for GitHub API requests. Adds GITHUB_TOKEN (if set) for the higher rate limit. */
export function githubHeaders(accept = "application/vnd.github+json") {
  const headers: Record<string, string> = { Accept: accept };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

export async function fetchRepo(repo: string) {
  const res = await fetch(`${GITHUB_API}/users/${encodeURIComponent(repo)}`, {
    headers: githubHeaders(),
  });

  if (res.status === 404) throw new Error(`GitHub repo "${repo}" not found`);
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);

  return res.json();
}
