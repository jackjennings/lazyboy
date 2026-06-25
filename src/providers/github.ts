import type { Provider, WorkItem } from "./types.ts";

type FetchFn = (url: string) => Promise<unknown[]>;

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

  constructor(
    opts: { repos: string[]; token: string; login: string; _fetch?: FetchFn },
  ) {
    this.repos = opts.repos;
    this.token = opts.token;
    this.login = opts.login;
    this._fetch = opts._fetch ?? this.defaultFetch.bind(this);
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

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const items: WorkItem[] = [];
    for (const repo of this.repos) {
      const url =
        `https://api.github.com/repos/${repo}/issues?assignee=${this.login}&state=open&per_page=50`;
      const issues = await this._fetch(url) as GitHubIssue[];
      for (const issue of issues) {
        const id = `gh-${issue.number}`;
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
}
