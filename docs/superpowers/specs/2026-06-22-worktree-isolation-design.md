# lazyboy — Sub-project 2: Worktree Isolation

**Date:** 2026-06-22
**Scope:** Sub-project 2. Adds git worktree creation before the intake phase so each ticket's implementation runs in an isolated branch and directory.

---

## Goal

Enable parallel ticket processing without implementation agents conflicting on the same working directory. Each ticket gets a dedicated git branch and linked worktree created before intake, so all phases share a consistent, isolated snapshot of the codebase.

---

## Architecture

### New module: `src/worktree.ts`

Two exported functions:

**`extractGitHubSlug(url: string): string`**

Extracts `"org/repo"` from a GitHub issue URL (e.g. `https://github.com/jackjennings/lazyboy/issues/42` → `"jackjennings/lazyboy"`).

**`findLocalRepo(roots: string[], slug: string): Promise<string | null>`**

Scans immediate subdirectories of each expanded root for a git repo whose `origin` remote URL contains the given `org/repo` slug. Returns the first matching path or `null`.

**`createWorktree(repoPath: string, ticketId: string): Promise<WorktreeInfo>`**

Runs `git worktree add -b <ticketId> ~/.lazyboy/worktrees/<ticketId>/<org>/<repo> main` inside `repoPath`. Returns the worktree path and branch name.

```typescript
export interface WorktreeInfo {
  path: string;    // ~/.lazyboy/worktrees/<ticket-id>/<org>/<repo>
  branch: string;  // e.g. "gh-42"
}
```

Worktree removal is out of scope for SP2 — handled in SP3.

---

### State changes

**`TicketState`** (`src/state/types.ts`) gets:

```typescript
worktrees: Record<string, WorktreeInfo>;  // keyed by "org/repo"
```

Always present. Defaults to `{}` when the ticket is first created (phase `"new"`). Populated with one entry before intake spawns.

**`Config`** (`src/state/types.ts`) gets:

```typescript
codebase: { roots: string[] };
```

**`meta.md` frontmatter** example after worktree creation:

```yaml
worktrees:
  jackjennings/lazyboy:
    path: /Users/jack.jennings/.lazyboy/worktrees/gh-42/jackjennings/lazyboy
    branch: gh-42
```

`store.ts` reads and writes the `worktrees` field. `config.ts` parses `[codebase] roots` from `config.toml`, defaulting to `[]` if absent.

---

### Tick changes (`src/tick.ts`)

Before calling `advancePhase` for each ticket, a pre-advance step handles worktree creation for `"new"` tickets:

```typescript
if (ticket.phase === "new") {
  const slug = extractGitHubSlug(ticket.url);  // "jackjennings/lazyboy"
  const repoPath = await findLocalRepo(config.codebase.roots, slug);
  if (!repoPath) {
    await writeTicket(stateDir, { ...ticket, phase: "needs-attention", updated: now });
    continue;
  }
  const wt = await createWorktree(repoPath, ticket.id);
  ticket = { ...ticket, worktrees: { [slug]: wt } };
  await writeTicket(stateDir, ticket);
}
```

If no local clone is found the ticket moves immediately to `needs-attention`. `advancePhase` is not called in that case.

---

### Executor changes (`src/executor.ts`, `src/run-phase.ts`)

**`ExecutorOptions`** gets:

```typescript
worktrees: Record<string, WorktreeInfo>;
```

`spawnPhase` serializes this into a `--worktrees` CLI arg (JSON) passed to `run-phase.ts`.

**`run-phase.ts`** mounts each entry at `/workspace/<org>/<repo>` (e.g. `/workspace/jackjennings/lazyboy`) as a read/write volume. Scope dirs remain at `/scope/*`.

**`advancePhase`** passes `ticket.worktrees` to `deps.spawn` only when `next === "implementation"`. All other phases receive `worktrees: {}`.

**Implementation phase prompt** (`src/phases/prompts/implementation.md`) references `/workspace/<org>/<repo>` as the writable directory for code changes.

---

## Error handling

| Condition | Behaviour |
|---|---|
| No local clone found in `codebase.roots` | Ticket → `needs-attention` before intake |
| `git worktree add` fails | Error propagates; tick logs it; ticket → `needs-attention` |
| `codebase.roots` not configured | Empty by default; all tickets with a repo URL → `needs-attention` |

---

## Testing

- **`src/worktree_test.ts`**: unit tests for `findLocalRepo` (mocked dir scan + git output) and `createWorktree` (mocked git command)
- **`src/tick_test.ts`**: verify worktree creation is attempted for `"new"` tickets; verify `needs-attention` transition when `findLocalRepo` returns `null`

---

## README updates

- Update SP2 description to match this design
- Add Opportunity entry: when no local clone is found, lazyboy could auto-clone the repo into a configured root rather than failing to `needs-attention`
- Add Opportunity entry: hooks system — a `runPreAdvance(ticket, config)` runner in `tick.ts` would let worktree creation, future ceremonies, and other lifecycle concerns register as composable hooks rather than inline conditionals. Deferred because one hook doesn't justify the abstraction.

---

## Out of scope (SP2)

- Worktree removal (SP3)
- Multiple repositories per ticket
- Auto-cloning missing repos
- Hooks abstraction
