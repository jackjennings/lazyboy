import type { Provider, WorkItem } from "./types.ts";
import { HttpClient } from "../http-client.ts";

type AccountResolver = (org: string) => { token: string; login: string };

export interface PrMetadata {
  url: string;
  title: string;
  baseRefName: string;
  headRefName: string;
}

type CloneFn = (
  slug: string,
  destDir: string,
  cwd: string,
  token: string,
) => Promise<void>;

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  html_url: string;
}

const GITHUB_STATUS_HINTS: Record<number, string> = {
  401:
    "authentication failed — check that GITHUB_TOKEN is set and `gh auth status` is valid",
  403: "forbidden — the token may lack required scopes or be rate-limited",
  404: "not found — check the repository path and the token's access to it",
};

function githubBodyMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === "string") return parsed.message;
  } catch {
    // non-JSON error bodies carry no structured message
  }
  return undefined;
}

function githubEndpoint(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function formatGitHubApiError(
  status: number,
  url: string,
  body: string,
): string {
  const message = githubBodyMessage(body);
  const detail = message ? `: ${message}` : "";
  const hint = GITHUB_STATUS_HINTS[status];
  const suffix = hint ? ` (${hint})` : "";
  return `GitHub API ${status}${detail} for ${githubEndpoint(url)}${suffix}`;
}

export class GitHubProvider implements Provider {
  private repos: string[];
  private accountResolver: AccountResolver;
  private http: HttpClient;
  private _clone: CloneFn;

  constructor(
    opts: {
      repos: string[];
      accountResolver: AccountResolver;
      http: HttpClient;
      _clone?: CloneFn;
    },
  ) {
    this.repos = opts.repos;
    this.accountResolver = opts.accountResolver;
    this.http = opts.http;
    this._clone = opts._clone ?? this.defaultClone.bind(this);
  }

  private async defaultClone(
    slug: string,
    destDir: string,
    cwd: string,
    token: string,
  ): Promise<void> {
    const env: Record<string, string> = {};
    const path = Deno.env.get("PATH");
    const home = Deno.env.get("HOME");
    if (path) env.PATH = path;
    if (home) env.HOME = home;
    if (token) env.GH_TOKEN = token;
    const result = await new Deno.Command("gh", {
      args: [
        "repo",
        "clone",
        `https://github.com/${slug}`,
        destDir,
        "--",
        "--depth",
        "1",
        "--single-branch",
      ],
      cwd,
      env,
    }).output();
    if (result.code !== 0) {
      const stderr = new TextDecoder().decode(result.stderr).trim();
      throw new Error(`gh repo clone failed for ${slug}: ${stderr}`);
    }
  }

  async clone(slug: string, destDir: string, cwd: string): Promise<void> {
    const org = slug.split("/")[0];
    const { token } = this.accountResolver(org);
    await this._clone(slug, destDir, cwd, token);
  }

  async isPRMerged(prUrl: string): Promise<boolean> {
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error(`Cannot parse PR URL: ${prUrl}`);
    const [, slug, number] = match;
    const { token } = this.accountResolver(slug.split("/")[0]);
    const apiUrl = `https://api.github.com/repos/${slug}/pulls/${number}/merge`;
    const res = await this.http.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (res.status === 204) return true;
    if (res.status === 404) return false;
    throw new Error(`Unexpected GitHub API status: ${res.status} for ${prUrl}`);
  }

  async prState(prUrl: string): Promise<"merged" | "closed" | "open"> {
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error(`Cannot parse PR URL: ${prUrl}`);
    const [, slug, number] = match;
    const { token } = this.accountResolver(slug.split("/")[0]);
    const apiUrl = `https://api.github.com/repos/${slug}/pulls/${number}`;
    const res = await this.http.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      throw new Error(
        formatGitHubApiError(
          res.status,
          apiUrl,
          await res.text().catch(() => ""),
        ),
      );
    }
    const data = await res.json();
    if (data.merged) return "merged";
    if (String(data.state) === "closed") return "closed";
    return "open";
  }

  async prMetadata(prUrl: string): Promise<PrMetadata> {
    const match = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!match) throw new Error(`Cannot parse PR URL: ${prUrl}`);
    const [, slug, number] = match;
    const { token } = this.accountResolver(slug.split("/")[0]);
    const apiUrl = `https://api.github.com/repos/${slug}/pulls/${number}`;
    const res = await this.http.get(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      throw new Error(
        formatGitHubApiError(
          res.status,
          apiUrl,
          await res.text().catch(() => ""),
        ),
      );
    }
    const data = await res.json();
    return {
      url: String(data.html_url),
      title: String(data.title),
      baseRefName: String(data.base?.ref ?? ""),
      headRefName: String(data.head?.ref ?? ""),
    };
  }

  async close(url: string): Promise<void> {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) {
      throw new Error(`Cannot parse GitHub issue URL: ${url}`);
    }
    const [, owner, repo, number] = match;
    const { token } = this.accountResolver(owner);
    const apiUrl =
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`;
    const res = await this.http.patch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
    if (!res.ok) {
      throw new Error(
        formatGitHubApiError(
          res.status,
          apiUrl,
          await res.text().catch(() => ""),
        ),
      );
    }
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    for (const repo of this.repos) {
      const org = repo.split("/")[0];
      const { token, login } = this.accountResolver(org);
      const url =
        `https://api.github.com/repos/${repo}/issues?assignee=${login}&state=open&per_page=50`;
      const res = await this.http.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!res.ok) {
        throw new Error(
          formatGitHubApiError(
            res.status,
            url,
            await res.text().catch(() => ""),
          ),
        );
      }
      const issues = (await res.json()) as GitHubIssue[];
      for (const issue of issues) {
        const id = `github/${repo}/${issue.number}`;
        const legacyId = `gh-${issue.number}`;
        if (knownIds.has(legacyId)) {
          console.log(
            `GitHubProvider.fetchNew: ${id} already tracked as legacy id ` +
              `${legacyId} (pending namespace-ticket-ids migration), skipping`,
          );
          continue;
        }
        if (!knownIds.has(id)) {
          items.push({
            id,
            provider: "github",
            title: issue.title,
            description: issue.body ?? "",
            url: issue.html_url,
          });
        }
      }
    }
    return items;
  }

  static toSortable(id: string): Array<string | number> {
    const m = id.match(/\/(\d+)$/);
    if (!m) return [id];
    return [parseInt(m[1], 10)];
  }
}
