This ticket produces a set of new work items (issues) rather than code or a
document. Do not create worktrees or pull requests.

Read the plan to find the chosen provider and the exact issue content to create.
Then follow the steps for that provider:

### GitHub

For each issue, run:

    gh issue create --repo <slug> --title "<title>" --body "<body>"

Record the URL printed by each command.

### Jira

For each issue, run:

    curl -s -u "${JIRA_EMAIL}:${JIRA_API_TOKEN}" \
         -X POST \
         -H "Content-Type: application/json" \
         "<base-url>/rest/api/2/issue" \
         -d '{"fields":{"project":{"key":"<PROJECT>"},"summary":"<title>","description":"<body>","issuetype":{"name":"Story"}}}'

The response JSON contains a `self` URL; derive the browse URL from it:
`<base-url>/browse/<key>` where `key` is the `key` field in the response. Record
that browse URL.

---

After creating all issues (whichever provider), edit `meta.md` to add a
`workItems` field to the YAML frontmatter:

    workItems:
      - url: <issue-url>
        title: <issue-title>

Do not create any pull requests. After recording all issue URLs in `meta.md`,
your work is complete.
