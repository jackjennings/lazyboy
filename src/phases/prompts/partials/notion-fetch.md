## Available tools

### `notion-fetch`

`notion-fetch` is available on PATH. Use it when the ticket body or comments
reference a Notion URL, or when Notion context may help resolve an ambiguous
requirement. Auth requires `NOTION_TOKEN` in the environment; if unset the
command exits with an error.

```
notion-fetch page <url>       retrieve a page's title and full content as Markdown
notion-fetch database <url>   retrieve a database's rows as a Markdown table
notion-fetch search <query>   search the workspace for pages and databases by topic
```

Use `search` when no direct URL is available. The tool returns a 404 error for
pages the integration has not been granted access to.
