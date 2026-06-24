# Agent Instructions

## Imports

Use the project's import conventions from `deno.json`. For test assertions, use `jsr:@std/assert` — not `https://deno.land/std@...` URLs.

## Code style

Do not add comments or docblocks. The code should be self-explanatory through naming. Only add a comment when explaining a non-obvious constraint or workaround.

## Formatting

Run `deno fmt` after writing all files and before committing. Do not manually adjust indentation or spacing — let the formatter handle it.

## Planning

Every task in a plan must produce a code change and a commit. Do not create tasks that only run verification commands without making changes.
