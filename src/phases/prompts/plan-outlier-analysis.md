You are analyzing a plan session that was flagged as an outlier: the number of
turns significantly exceeded the spec's criterion count.

You have been given:

- The ticket directory (containing `log.ndjson`, `*-spec.md`, and
  `*-plan.usage.json`)
- The ticket ID
- The lazyboy worktree (containing `src/phases/prompts/`)

Follow these steps:

1. Read `log.ndjson` from the ticket directory. Find the `phase-end` entry where
   `phase` is `"plan"` and extract its `sessionId`.

2. Search `~/.claude/projects/` for NDJSON files whose content references that
   session ID. Look for a file containing `"session_id": "<sessionId>"` or
   `"id": "<sessionId>"`. If no transcript is found, skip to step 4.

3. When the transcript is available, parse each line as JSON and collect every
   `tool_use` event. Group by `(name, path_argument)` where `path_argument` is
   the first string argument that looks like a file path. Identify the dominant
   waste pattern among:
   - Redundant reads: same spec, enrichment, or meta file read more than twice
   - Iterative rewrites: the same section of the plan output file edited more
     than twice
   - Repeated model selection: the `phases.implementation.model` or `thinking`
     field in `meta.md` changed more than once

4. Read the most recent `*-spec.md` from the ticket directory. Read
   `src/phases/prompts/plan.md` from the lazyboy worktree. Identify the missing
   or imprecise instruction that allowed the waste pattern.

5. Apply a single, minimal edit to `src/phases/prompts/plan.md` that prevents
   recurrence. Examples:
   - Add an instruction to read each reference file exactly once and hold its
     content in memory rather than re-reading on each section.
   - Add an instruction to commit the model/thinking selection after the first
     survey of the spec and not revisit it.
   - Add an instruction to write the full plan in one pass once all input files
     have been read, rather than iterating section by section. Make the
     instruction concrete and actionable; avoid vague directives.

6. From the lazyboy worktree, commit the change:
   ```
   git add src/phases/prompts/plan.md
   git commit -m "improve plan prompt to prevent outlier pattern observed in <ticketId>"
   ```

7. Write your findings to `<YYYYMMDDTHHMMSS>-plan-outlier-analysis.md` in the
   ticket directory. Include: the turns/criterionCount ratio, the identified
   pattern, the root cause, and the exact prompt change made (full diff or
   before/after).

8. Open a draft PR against `jackjennings/lazyboy`. Before creating it, check the
   lazyboy worktree for a pull request template. Look for each path in order and
   stop at the first match:

   - `.github/pull_request_template.md`
   - `.github/PULL_REQUEST_TEMPLATE.md`
   - `PULL_REQUEST_TEMPLATE.md`

   If a file is found, use its section structure as the skeleton for the body,
   filling each section with real content. If no file exists at any of those
   paths — including when only a `.github/PULL_REQUEST_TEMPLATE/` directory is
   present — use a free-form body.

   ```
   gh pr create --draft \
     --title "Improve plan prompt to prevent outlier pattern observed in <ticketId>" \
     --body "..."
   ```

   The body must cite the triggering ticket ID, the turns/criterionCount ratio,
   and the root cause identified in step 3 or 4.

If the transcript was unavailable, base your analysis on the
turns/criterionCount ratio and the plan structure alone. Still commit the change
and open the PR.

Do not modify `meta.md`, `log.ndjson`, or any file outside
`src/phases/prompts/plan.md` in the lazyboy worktree.
