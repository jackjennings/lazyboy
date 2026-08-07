import { HttpClient } from "../http-client.ts";

export async function jiraTransition(opts: {
  baseUrl: string;
  email: string;
  apiToken: string;
  issueKey: string;
  targetStatusCategoryKey: string;
  http: HttpClient;
}): Promise<void> {
  const auth = btoa(`${opts.email}:${opts.apiToken}`);
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const transitionsUrl =
    `${opts.baseUrl}/rest/api/3/issue/${opts.issueKey}/transitions`;
  const res = await opts.http.get(transitionsUrl, { headers });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${transitionsUrl}`);
  }
  const data = (await res.json()) as {
    transitions: Array<{
      id: string;
      to: { statusCategory: { key: string } };
    }>;
  };
  const transition = data.transitions.find(
    (t) => t.to.statusCategory.key === opts.targetStatusCategoryKey,
  );
  if (!transition) {
    throw new Error(
      `No transition to ${opts.targetStatusCategoryKey} available for ${opts.issueKey}`,
    );
  }

  const postRes = await opts.http.post(transitionsUrl, {
    headers,
    body: JSON.stringify({ transition: { id: transition.id } }),
  });
  if (!postRes.ok) {
    throw new Error(`Jira API error: ${postRes.status} ${transitionsUrl}`);
  }
}
