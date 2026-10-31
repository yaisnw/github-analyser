import { AnalysisError } from "@/lib/errors";

const GITHUB_API = "https://api.github.com";
const GITHUB_TIMEOUT_MS = 10_000;

export type GithubTarget =
  | { kind: "repo"; repo: string }
  | { kind: "profile"; user: string };

// Top-level github.com paths that look like usernames but aren't.
const RESERVED_PATHS = new Set([
  "about", "account", "apps", "collections", "contact", "customer-stories", "events",
  "explore", "features", "issues", "login", "logout", "marketplace", "new", "notifications",
  "orgs", "organizations", "pricing", "pulls", "search", "security", "settings", "signup",
  "sponsors", "topics", "trending", "users",
]);

const USERNAME_RE = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

/** Works out whether a GitHub URL points at a repo or a user profile. */
export function parseGithubUrl(input: string): GithubTarget | null {
  try {
    const url = new URL(input);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || RESERVED_PATHS.has(owner.toLowerCase()) || !USERNAME_RE.test(owner)) return null;

    if (!repo) return { kind: "profile", user: owner };
    return { kind: "repo", repo: `${owner}/${repo.replace(/\.git$/, "")}` };
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

// ---------- Profile data ----------

type GhUser = {
  login: string;
  type: string;
  name: string | null;
  bio: string | null;
  company: string | null;
  location: string | null;
  blog: string | null;
  created_at: string;
  followers: number;
  following: number;
  public_repos: number;
};

type GhRepo = {
  name: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  language: string | null;
  pushed_at: string;
  topics?: string[];
};

type PinnedRepo = {
  nameWithOwner: string;
  description: string | null;
  stargazerCount: number;
  primaryLanguage: { name: string } | null;
  isFork: boolean;
};

type ContributionStats = {
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalPullRequestReviewContributions: number;
  totalIssueContributions: number;
  restrictedContributionsCount: number;
};

async function ghFetch(path: string, accept?: string): Promise<Response> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: githubHeaders(accept),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new AnalysisError(
      "GitHub API rate limit reached. Set GITHUB_TOKEN or try again later.",
      429,
    );
  }
  return res;
}

/** Fetches JSON from GitHub, returning null on any failure (for data that is nice to have). */
async function optionalJson<T>(path: string): Promise<T | null> {
  try {
    const res = await ghFetch(path);
    return res.ok ? ((await res.json()) as T) : null;
  } catch (err) {
    if (err instanceof AnalysisError) throw err;
    return null;
  }
}

async function fetchProfileReadme(user: string): Promise<string | null> {
  try {
    const res = await ghFetch(
      `/repos/${encodeURIComponent(user)}/${encodeURIComponent(user)}/readme`,
      "application/vnd.github.raw",
    );
    if (!res.ok) return null;
    return (await res.text()).slice(0, 5_000);
  } catch (err) {
    if (err instanceof AnalysisError) throw err;
    return null;
  }
}

/** Pinned repos and contribution totals. GraphQL always needs a token. */
async function fetchGraphql(user: string) {
  if (!process.env.GITHUB_TOKEN) return null;
  const query = `query($login: String!) {
    user(login: $login) {
      pinnedItems(first: 6, types: REPOSITORY) {
        nodes { ... on Repository { nameWithOwner description stargazerCount isFork primaryLanguage { name } } }
      }
      contributionsCollection {
        totalCommitContributions totalPullRequestContributions
        totalPullRequestReviewContributions totalIssueContributions restrictedContributionsCount
      }
    }
  }`;
  try {
    const res = await fetch(`${GITHUB_API}/graphql`, {
      method: "POST",
      headers: { ...githubHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables: { login: user } }),
      signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()).data?.user;
    if (!data) return null;
    return {
      pinned: (data.pinnedItems?.nodes ?? []) as PinnedRepo[],
      contributions: data.contributionsCollection as ContributionStats,
    };
  } catch {
    return null;
  }
}

function summariseLanguages(repos: GhRepo[]): string {
  const counts = new Map<string, number>();
  for (const r of repos) {
    if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  return sorted.length ? sorted.map(([lang, n]) => `${lang} (${n})`).join(", ") : "none detected";
}

function repoLine(r: GhRepo): string {
  const tags = [r.language, `${r.stargazers_count} stars`, `last push ${r.pushed_at.slice(0, 10)}`, r.archived ? "archived" : null]
    .filter(Boolean)
    .join(", ");
  return `- ${r.name} (${tags}): ${r.description ?? "no description"}`;
}

/**
 * Gathers everything we can about a user in code and formats it as text for the model.
 * Doing this up front saves model steps, which are limited by the Gemini free tier.
 */
export async function fetchProfileData(user: string): Promise<string> {
  const encoded = encodeURIComponent(user);
  const userRes = await ghFetch(`/users/${encoded}`);
  if (userRes.status === 404) throw new AnalysisError(`GitHub user "${user}" not found`, 404);
  if (!userRes.ok) throw new AnalysisError(`GitHub API error: ${userRes.status}`, 502);
  const profile = (await userRes.json()) as GhUser;

  if (profile.type === "Organization") {
    throw new AnalysisError(
      `"${user}" is an organisation. Profile analysis only supports user accounts.`,
      400,
    );
  }

  const [readme, repos, orgs, graph] = await Promise.all([
    fetchProfileReadme(user),
    optionalJson<GhRepo[]>(`/users/${encoded}/repos?per_page=50&sort=pushed`),
    optionalJson<{ login: string }[]>(`/users/${encoded}/orgs`),
    fetchGraphql(user),
  ]);

  const allRepos = repos ?? [];
  const own = allRepos.filter(r => !r.fork);
  const topRepos = [...own].sort((a, b) => b.stargazers_count - a.stargazers_count).slice(0, 8);
  const recentRepos = own.slice(0, 8); // already sorted by last push

  const lines: string[] = [
    `PROFILE: ${profile.login}${profile.name ? ` (${profile.name})` : ""}`,
    `Bio: ${profile.bio ?? "none"}`,
    `Company: ${profile.company ?? "none"} | Location: ${profile.location ?? "none"} | Website: ${profile.blog || "none"}`,
    `Account created: ${profile.created_at.slice(0, 10)} | Followers: ${profile.followers} | Following: ${profile.following}`,
    `Public repos: ${profile.public_repos} (${own.length} original, ${allRepos.length - own.length} forks, among the ${allRepos.length} most recently pushed)`,
    `Organisations: ${orgs?.length ? orgs.map(o => o.login).join(", ") : "none public"}`,
    "",
    `LANGUAGES (by number of original repos): ${summariseLanguages(own)}`,
  ];

  if (graph) {
    const c = graph.contributions;
    lines.push(
      "",
      `CONTRIBUTIONS (last year): ${c.totalCommitContributions} commits, ${c.totalPullRequestContributions} pull requests, ` +
        `${c.totalPullRequestReviewContributions} reviews, ${c.totalIssueContributions} issues, ` +
        `${c.restrictedContributionsCount} more in private repos (details hidden)`,
      "",
      "PINNED REPOS:",
      ...(graph.pinned.length
        ? graph.pinned.map(
            p =>
              `- ${p.nameWithOwner} (${p.primaryLanguage?.name ?? "no language"}, ${p.stargazerCount} stars${p.isFork ? ", fork" : ""}): ${p.description ?? "no description"}`,
          )
        : ["none pinned"]),
    );
  } else {
    lines.push(
      "",
      "NOTE: pinned repos and contribution totals are unavailable (no GitHub token configured). Judge activity from the push dates in the repo lists below.",
    );
  }

  lines.push(
    "",
    "TOP ORIGINAL REPOS BY STARS:",
    ...(topRepos.length ? topRepos.map(repoLine) : ["none"]),
    "",
    "MOST RECENTLY PUSHED ORIGINAL REPOS:",
    ...(recentRepos.length ? recentRepos.map(repoLine) : ["none"]),
    "",
    "PROFILE README:",
    readme ?? "none",
  );

  return lines.join("\n");
}
