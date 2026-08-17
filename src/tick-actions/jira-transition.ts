import { HttpClient } from "../http-client.ts";

export async function jiraTransition(opts: {
  baseUrl: string;
  email: string;
  apiToken: string;
  issueKey: string;
  targetStatusName: string;
  http: HttpClient;
}): Promise<void> {
  const auth = btoa(`${opts.email}:${opts.apiToken}`);
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  const issueUrl =
    `${opts.baseUrl}/rest/api/3/issue/${opts.issueKey}?fields=status&expand=transitions`;
  const res = await opts.http.get(issueUrl, { headers });
  if (!res.ok) {
    throw new Error(`Jira API error: ${res.status} ${issueUrl}`);
  }
  const data = (await res.json()) as {
    fields: { status: { name: string } };
    transitions: Array<{ id: string; to: { name: string } }>;
  };

  if (data.fields.status.name === opts.targetStatusName) {
    return;
  }

  const transition = data.transitions.find(
    (t) => t.to.name === opts.targetStatusName,
  );
  if (!transition) {
    throw new Error(
      `No transition to "${opts.targetStatusName}" available for ${opts.issueKey}`,
    );
  }

  const transitionsUrl =
    `${opts.baseUrl}/rest/api/3/issue/${opts.issueKey}/transitions`;
  const postRes = await opts.http.post(transitionsUrl, {
    headers,
    body: JSON.stringify({ transition: { id: transition.id } }),
  });
  if (!postRes.ok) {
    throw new Error(`Jira API error: ${postRes.status} ${transitionsUrl}`);
  }
}
