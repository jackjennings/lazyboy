This ticket produces a set of new work items (issues) rather than code or a
document.

First, determine which issue tracker is most appropriate for the work items this
ticket will create. Read `meta.md` to identify the originating ticket's provider
and URL:

- If the originating ticket is from **Jira** (`provider: jira`), creating Jira
  issues is most appropriate. Derive the base URL from the ticket URL (e.g.
  `https://company.atlassian.net/browse/PROJ-123` → base URL
  `https://company.atlassian.net`; project key `PROJ`).
- If the originating ticket is from **GitHub** (`provider: github`), creating
  GitHub issues is most appropriate. Derive the repo slug from the ticket ID
  (e.g. `github/jackjennings/lazyboy/431` → `jackjennings/lazyboy`).

Document your provider choice and the connection details (base URL and project
key for Jira; repo slug for GitHub) at the top of your spec output.

Your spec must then enumerate the specific issues to create:

- The title of each issue.
- A one-paragraph description of what the issue covers and why it is needed.
- The rationale for creating it as a separate issue.

The output is a concrete list, not an open-ended plan. Do not include
implementation details; focus on scope and intent. Do not include acceptance
criteria, test plans, or "What NOT to Build" sections — the deliverable is the
provider choice and the enumerated issue list described above.
