import type { Provider, WorkItem } from "./types.ts";

type AccountResolver = (org: string) => { token: string; login: string };
type FetchFn = (url: string, token: string) => Promise<unknown[]>;
type PatchFn = (url: string, body: unknown, token: string) => Promise<void>;

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  html_url: string;
}

export class GitHubProvider implements Provider {
  private repos: string[];
  private accountResolver: AccountResolver;
  private _fetch: FetchFn;
  private _patch: PatchFn;

  constructor(
    opts: {
      repos: string[];
      accountResolver: AccountResolver;
      _fetch?: FetchFn;
      _patch?: PatchFn;
    },
  ) {
    this.repos = opts.repos;
    this.accountResolver = opts.accountResolver;
    this._fetch = opts._fetch ?? this.defaultFetch.bind(this);
    this._patch = opts._patch ?? this.defaultPatch.bind(this);
  }

  private async defaultFetch(url: string, token: string): Promise<unknown[]> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${url}`);
    return res.json();
  }

  private async defaultPatch(
    url: string,
    body: unknown,
    token: string,
  ): Promise<void> {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${url}`);
  }

  async close(url: string): Promise<void> {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!match) {
      throw new Error(`Cannot parse GitHub issue URL: ${url}`);
    }
    const [, owner, repo, number] = match;
    const { token } = this.accountResolver(owner);
    await this._patch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      { state: "closed", state_reason: "completed" },
      token,
    );
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    for (const repo of this.repos) {
      const org = repo.split("/")[0];
      const { token, login } = this.accountResolver(org);
      const url =
        `https://api.github.com/repos/${repo}/issues?assignee=${login}&state=open&per_page=50`;
      const issues = await this._fetch(url, token) as GitHubIssue[];
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
