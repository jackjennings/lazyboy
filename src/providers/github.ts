import type { Provider, WorkItem } from "./types.ts";

type FetchFn = (url: string) => Promise<unknown[]>;
type PatchFn = (url: string, body: unknown) => Promise<void>;

interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  html_url: string;
}

export class GitHubProvider implements Provider {
  private repos: string[];
  private token: string;
  private login: string;
  private _fetch: FetchFn;
  private _patch: PatchFn;

  constructor(
    opts: {
      repos: string[];
      token: string;
      login: string;
      _fetch?: FetchFn;
      _patch?: PatchFn;
    },
  ) {
    this.repos = opts.repos;
    this.token = opts.token;
    this.login = opts.login;
    this._fetch = opts._fetch ?? this.defaultFetch.bind(this);
    this._patch = opts._patch ?? this.defaultPatch.bind(this);
  }

  private async defaultFetch(url: string): Promise<unknown[]> {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (!res.ok) throw new Error(`GitHub API error: ${res.status} ${url}`);
    return res.json();
  }

  private async defaultPatch(url: string, body: unknown): Promise<void> {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.token}`,
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
    await this._patch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
      { state: "closed", state_reason: "completed" },
    );
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    for (const repo of this.repos) {
      const url =
        `https://api.github.com/repos/${repo}/issues?assignee=${this.login}&state=open&per_page=50`;
      const issues = await this._fetch(url) as GitHubIssue[];
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
