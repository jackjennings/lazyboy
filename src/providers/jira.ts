import type { Provider, WorkItem } from "./types.ts";

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown;
  };
}

export class JiraProvider implements Provider {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private project: string;
  private _fetch: FetchFn;

  constructor(opts: {
    baseUrl: string;
    email: string;
    apiToken: string;
    project: string;
    _fetch?: FetchFn;
  }) {
    this.baseUrl = opts.baseUrl;
    this.email = opts.email;
    this.apiToken = opts.apiToken;
    this.project = opts.project;
    this._fetch = opts._fetch ?? ((url, init) => fetch(url, init));
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const jql =
      `assignee = currentUser() AND project = ${this.project} AND statusCategory != Done`;
    const url = `${this.baseUrl}/rest/api/3/search?jql=${
      encodeURIComponent(jql)
    }&maxResults=50`;
    const auth = btoa(`${this.email}:${this.apiToken}`);
    const res = await this._fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`Jira API error: ${res.status} ${url}`);
    const data = (await res.json()) as { issues: JiraIssue[] };
    const items: WorkItem[] = [];
    for (const issue of data.issues) {
      const id = `jira-${issue.key}`;
      if (!knownIds.has(id)) {
        items.push({
          id,
          provider: "jira",
          title: issue.fields.summary,
          description: issue.fields.description == null
            ? ""
            : JSON.stringify(issue.fields.description),
          url: `${this.baseUrl}/browse/${issue.key}`,
        });
      }
    }
    return items;
  }
}
