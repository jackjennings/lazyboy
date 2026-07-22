# Design: repo-corpus grounding for intake scope proposals

## Problem

Jira tickets almost always land in `needs-attention` right after intake. GitHub
tickets don't, because `createWorktreeAction` seeds `githubSlugs` with a
guaranteed slug extracted from the issue's own URL
(`extractGitHubSlug(ticket.url)`, `src/tick-actions/create-worktree.ts:49-61`).
Jira issues have no such structural repo identity, so the ticket's eventual
scope depends entirely on the intake agent guessing an `org/repo` slug from
ticket text alone, with zero grounding: no directory listing of
`codebase.roots`, no list of configured GitHub repos. Any guess that doesn't
match the strict slug/URL regex in `resolveGitHubSlug` (`src/worktree.ts:79-93`)
leaves `githubSlugs` empty, which unconditionally trips `needs-attention`
(`create-worktree.ts:75-83`) — even when intake proposed a valid local path,
since local paths never produce a worktree.

The user wants every ticket, regardless of provider, to be able to pull
additional relevant repos into scope based on the ticket text and the project's
actual codebase — not just Jira tickets defaulting to failure.

## Goal

Ground the intake agent's `## Proposed Scope` guess in a real inventory of
repositories, for every provider, so it can select actual `org/repo` slugs
instead of guessing blind. This is the fix for Jira (no more blind guesses) and
it also lets GitHub tickets pull in additional repos beyond their own, using the
same real inventory.

## Design

### 1. Repo corpus builder (`src/worktree.ts`)

```ts
interface RepoCandidate {
  slug: string;
  localPath: string | null;
}

function listRepoCorpus(
  roots: string[],
  configuredRepos: string[],
): Promise<RepoCandidate[]>;
```

- Walks each root two levels deep, same traversal `findLocalRepo` already does.
  For each candidate directory, runs `git remote get-url origin` (via the
  existing injectable `runGit`) and derives the slug from the **remote URL**,
  not the directory name — this keeps the corpus consistent with how
  `findLocalRepo` later matches slugs to paths.
- Missing/unreadable roots are skipped silently (same tolerance as
  `findLocalRepo`).
- Slug parsing needs to handle both HTTPS (`https://github.com/org/repo.git`)
  and SSH (`git@github.com:org/repo.git`) remote forms. Add:

  ```ts
  function parseRemoteSlug(url: string): string | null;
  ```

  `extractGitHubSlug` is unchanged — it only ever parses `ticket.url`, which is
  always an `https://github.com/...` issue URL, not a git remote.
- Merges in `configuredRepos` (i.e. `config.github.repos`) as candidates with
  `localPath: null` when not already found locally. De-dupe by slug, local match
  wins.

```ts
function formatRepoCorpus(candidates: RepoCandidate[]): string;
```

- Pure formatter → a `## Available Repositories` markdown block. Local entries
  show their path; remote-only entries are flagged as not checked out locally.
  Empty input → empty string.

### 2. Wiring (`src/tick.ts`)

- `TickDeps` gains:

  ```ts
  buildRepoCorpusText: (() => Promise<string>);
  ```

  Wired in production closing over `config`, mirroring the existing
  `resolveModelConfig` closure pattern:

  ```ts
  buildRepoCorpusText: async () =>
    formatRepoCorpus(
      await listRepoCorpus(
        config.codebase.roots.map(expandHome),
        config.github.repos,
      ),
    ),
  ```

- In `advancePhase`'s `ticket.status === "new"` branch (`src/tick.ts:203-223`),
  after building `prompt` from the base intake prompt + provider supplement,
  append the corpus text (call `deps.buildRepoCorpusText()`) for **every**
  provider — not gated on `ticket.provider !== "github"`. If the corpus text is
  empty, append nothing.

### 3. Prompt (`src/phases/prompts/intake.md`)

- Add one paragraph: when an `## Available Repositories` section appears below
  (injected at runtime), prefer choosing `Proposed Scope` entries from it; the
  agent may still propose an unlisted GitHub slug/URL when the ticket clearly
  references an external repo not in the list.
- No provider-specific prompt file needed — the corpus block is universal, not a
  `loadProviderPrompt` supplement.

### 4. Downstream — unchanged

- `create-worktree.ts`'s gating logic (`githubSlugs.size === 0` →
  `needs-attention`) is untouched. Once intake reliably proposes a real,
  resolvable slug for Jira tickets, that branch stops firing for the common case
  without any change to its own code.

### Non-goal / known limitation

A ticket whose only relevant repo has no GitHub remote at all (fully local, no
`github.com` origin) still cannot get a worktree — `createWorktree` and
`cloneRemoteRepo` are both slug-keyed. Not addressed by this change; flag as a
future follow-up if it comes up in practice.

## Testing

- `listRepoCorpus`: temp dirs in a two-level `org/repo` layout, stubbed `runGit`
  covering HTTPS/SSH remotes, missing/unreadable roots, dedup against
  `configuredRepos` (local match wins).
- `parseRemoteSlug`: pure unit tests — HTTPS, SSH, malformed input.
- `formatRepoCorpus`: pure unit tests — including empty input → `""`.
- `advancePhase` (existing `tick_test.ts`): assert `buildRepoCorpusText` is
  called and its output is appended to the intake prompt, for both a Jira ticket
  and a GitHub ticket (spy via `@std/testing/mock`).
- No changes needed to `create-worktree_test.ts` — the existing "Jira ticket,
  only local paths in intake → needs-attention" test still documents correct
  behavior for the genuine no-match case.
