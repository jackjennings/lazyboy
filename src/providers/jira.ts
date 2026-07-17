import type { Provider, WorkItem } from "./types.ts";
import { jiraTransition } from "../tick-actions/jira-transition.ts";

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

  async close(url: string): Promise<void> {
    const match = url.match(/\/browse\/([^/]+)$/);
    if (!match) {
      throw new Error(`Cannot parse Jira issue URL: ${url}`);
    }
    await jiraTransition({
      baseUrl: this.baseUrl,
      email: this.email,
      apiToken: this.apiToken,
      issueKey: match[1],
      targetStatusCategoryKey: "done",
      fetch: this._fetch,
    });
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const jql =
      `assignee = currentUser() AND project = ${this.project} AND statusCategory != Done`;
    const url = `${this.baseUrl}/rest/api/3/search/jql`;
    const auth = btoa(`${this.email}:${this.apiToken}`);
    const res = await this._fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        maxResults: 50,
        fields: ["key", "summary", "description"],
      }),
    });
    if (!res.ok) throw new Error(`Jira API error: ${res.status} ${url}`);
    const data = (await res.json()) as { issues: JiraIssue[] };
    const items: WorkItem[] = [];
    for (const issue of data.issues) {
      if (!issue.fields) continue;
      const id = `jira/${issue.key}`;
      const legacyId = `jira-${issue.key}`;
      if (knownIds.has(legacyId)) {
        console.log(
          `JiraProvider.fetchNew: ${id} already tracked as legacy id ` +
            `${legacyId} (pending namespace-ticket-ids migration), skipping`,
        );
        continue;
      }
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
