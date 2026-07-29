You are analyzing an implementation session that was flagged as an outlier: the
number of turns significantly exceeded the plan's task count.

You have been given:

- The ticket directory (containing `log.ndjson`, `*-plan.md`, and
  `*-implementation.usage.json`)
- The ticket ID
- The lazyboy worktree (containing `src/phases/prompts/`)
- The state directory (where learnings are queued)

Follow these steps:

1. Read `log.ndjson` from the ticket directory. Find the `phase-end` entry where
   `phase` is `"implementation"` and extract its `sessionId`.

2. Search `~/.claude/projects/` for NDJSON files whose content references that
   session ID. Look for a file containing `"session_id": "<sessionId>"` or
   `"id": "<sessionId>"`. If no transcript is found, skip to step 4.

3. When the transcript is available, parse each line as JSON and collect every
   `tool_use` event. Group by `(name, path_argument)` where `path_argument` is
   the first string argument that looks like a file path. Identify the dominant
   pattern: fragmented edits (many Edit calls against one file), redundant reads
   (same file read more than three times), or retry loops (repeated identical
   tool calls). Note the plan task or section that correlates with the spike.

4. Read the most recent `*-plan.md` from the ticket directory. Read the
   implementation prompt at `src/phases/prompts/implementation.md` (and
   `src/phases/prompts/plan.md` if the pattern implicates the plan phase).
   Identify the missing or imprecise instruction that allowed the inefficient
   pattern.

5. Apply a single, minimal edit to one file in `src/phases/prompts/` that
   prevents recurrence. Examples:
   - Add an explicit instruction to enumerate all call sites before making edits
     when changing a function signature.
   - Add an instruction to use a scripted pass (`sed -i` or `deno eval`) for
     repetitive same-file changes rather than repeated Edit calls.
   - Add an instruction to read a file once and hold its content in memory
     rather than re-reading it on each edit. Make the instruction concrete and
     actionable; avoid vague directives.

6. Write a learning entry to
   `<State directory>/learnings/<YYYYMMDDTHHMMSS>.json` using the current UTC
   time for the filename slug. The JSON object must have exactly these fields:

   ```json
   {
     "id": "<YYYYMMDDTHHMMSS>",
     "ticketId": "<ticket ID from context>",
     "repo": "jackjennings/lazyboy",
     "targetFile": "<repo-relative path of the file changed in step 5, e.g. src/phases/prompts/implementation.md>",
     "content": "<full new file content after the edit from step 5>",
     "prTitle": "Improve prompt to prevent <short label for inefficient pattern> observed in <ticketId>",
     "prBody": "<body text citing the triggering ticket ID, the turns/task_count ratio, and the root cause>"
   }
   ```

   Do not run `git` or `gh` commands. The learning entry will be picked up by
   the next tick and applied from a clean worktree.

7. Write your findings to `<YYYYMMDDTHHMMSS>-outlier-analysis.md` in the ticket
   directory. Include: the turns/task_count ratio, the identified pattern, the
   root cause, and the exact prompt change made (full diff or before/after).

If the transcript was unavailable, base your analysis on the turns/task_count
ratio and the plan structure alone. You may propose a general improvement (e.g.
requiring explicit enumeration of all call sites for any rename task) rather
than a specific diagnosis. Still write the learning entry and the findings file.

Do not modify `meta.md`, `log.ndjson`, or any file outside `src/phases/prompts/`
in the lazyboy worktree. Do not run any version control or `gh` CLI commands.
