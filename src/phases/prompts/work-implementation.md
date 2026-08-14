This ticket produces a set of new GitHub issues rather than code or a document.
Do not create worktrees or pull requests.

Follow these steps:

1. Derive the originating repository slug from the ticket ID. For example,
   `github/jackjennings/lazyboy/431` → `jackjennings/lazyboy`.
2. For each issue listed in the plan, run:

       gh issue create --repo <slug> --title "<title>" --body "<body>"

   Record the URL returned by each command.
3. Edit `meta.md` to add a `workItems` field to the YAML frontmatter with each
   created issue's URL and title:

       workItems:
         - url: <returned-url>
           title: <issue-title>

Do not create any pull requests. After recording all issue URLs in `meta.md`,
your work is complete.
