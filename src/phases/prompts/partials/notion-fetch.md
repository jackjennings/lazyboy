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

```
notion-fetch create <parent-page-url> <title>
```

Creates a new child page under `<parent-page-url>` with the given `<title>`.
Prints the new page URL to stdout. Exits 0 on success.

```
notion-fetch append <page-url>
```

Reads Markdown from stdin. Converts it to Notion blocks and appends them to the
page at `<page-url>`. Exits 0 on success. Supported elements: paragraphs,
headings H1–H3, bulleted and numbered list items, fenced code blocks, block
quotes, horizontal rules.
