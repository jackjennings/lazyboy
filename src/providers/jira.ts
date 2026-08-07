import { adf2markdown } from "adf2markdown";
import type { Provider, WorkItem } from "./types.ts";
import { jiraTransition } from "../tick-actions/jira-transition.ts";
import { HttpClient } from "../http-client.ts";

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown;
    parent?: { key: string; fields: { summary: string } };
  };
}

export class JiraProvider implements Provider {
  private baseUrl: string;
  private email: string;
  private apiToken: string;
  private project: string;
  private http: HttpClient;

  constructor(opts: {
    baseUrl: string;
    email: string;
    apiToken: string;
    project: string;
    http: HttpClient;
  }) {
    this.baseUrl = opts.baseUrl;
    this.email = opts.email;
    this.apiToken = opts.apiToken;
    this.project = opts.project;
    this.http = opts.http;
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
      http: this.http,
    });
  }

  private async fetchAncestors(key: string, auth: string): Promise<string> {
    const url =
      `${this.baseUrl}/rest/api/3/issue/${key}?fields=summary,description,parent`;
    const res = await this.http.get(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return "";
    const issue = (await res.json()) as {
      fields: {
        summary: string;
        description: unknown;
        parent?: { key: string };
      };
    };
    const desc = issue.fields.description == null ||
        typeof issue.fields.description !== "object"
      ? ""
      // deno-lint-ignore no-explicit-any
      : adf2markdown(issue.fields.description as any).trim();
    const block =
      `## Parent context: ${key} — ${issue.fields.summary}\n\n${desc}`;
    if (issue.fields.parent) {
      const further = await this.fetchAncestors(issue.fields.parent.key, auth);
      if (further) return `${block}\n\n${further}`;
    }
    return block;
  }

  async fetchNew(knownIds: Set<string>): Promise<WorkItem[]> {
    const jql =
      `assignee = currentUser() AND project = ${this.project} AND statusCategory != Done`;
    const url = `${this.baseUrl}/rest/api/3/search/jql`;
    const auth = btoa(`${this.email}:${this.apiToken}`);
    const res = await this.http.post(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jql,
        maxResults: 50,
        fields: ["key", "summary", "description", "parent"],
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
        let description = issue.fields.description == null ||
            typeof issue.fields.description !== "object"
          ? ""
          // deno-lint-ignore no-explicit-any
          : adf2markdown(issue.fields.description as any).trim();
        if (issue.fields.parent) {
          const ancestors = await this.fetchAncestors(
            issue.fields.parent.key,
            auth,
          );
          if (ancestors) description = `${description}\n\n---\n\n${ancestors}`;
        }
        items.push({
          id,
          provider: "jira",
          title: issue.fields.summary,
          description,
          url: `${this.baseUrl}/browse/${issue.key}`,
        });
      }
    }
    return items;
  }

  static toSortable(id: string): Array<string | number> {
    const m = id.match(/^jira\/([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    if (!m) return [id];
    return [m[1], parseInt(m[2], 10)];
  }
}
