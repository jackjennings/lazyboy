---
name: lazyboy-config
description: Use when changing lazyboy runtime settings — adding a repo or codebase root, setting a per-phase model or thinking level, wiring GitHub tokens/accounts/orgs, switching agent type or pi provider, tuning tick concurrency, enabling todo.txt or Jira, scheduling a ceremony, or adding a brand-new config key. Also use when lazyboy fails at startup with a config.toml error or a setting appears to be ignored.
---

# lazyboy configuration

## Overview

lazyboy reads `~/.config/lazyboy/config.toml` fresh on every tick and on every
CLI command. There is no daemon to restart and no cache — an edit takes effect
on the next tick. `loadConfig` (`src/config.ts`) is the only parser; it maps
`snake_case` TOML keys to `camelCase` fields on the `Config` type
(`src/state/types.ts`).

Secrets are **not** config. Tokens live in the environment, and under launchd or
cron in `~/.config/lazyboy/env` (sourced by `scripts/tick.sh`).

## Files

| Path                                       | What                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `~/.config/lazyboy/config.toml`            | The config                                                   |
| `~/.config/lazyboy/env`                    | `KEY=value` lines sourced before the tick (tokens go here)   |
| `{stateDir}/ceremonies/<name>/config.toml` | Per-ceremony schedule (separate parser, `src/ceremonies.ts`) |

Before editing anything under `~`, run `chezmoi source-path <file>`; edit the
source path if one is returned. (`config.toml` is currently unmanaged.)

## Procedure

1. Read the current `~/.config/lazyboy/config.toml`.
2. Edit it (Edit, not Write — preserve the operator's existing sections).
3. Validate: `lazyboy status`. It calls `loadConfig`, so a parse or validation
   error surfaces immediately. Clean output means the file loaded.
4. Nothing to restart. Do **not** run `lazyboy enable`/`disable` or `launchctl`
   — those are for the LaunchAgent plist, not config.

## Key reference

Only `[github].repos` and `[state].dir` are required; everything else defaults.

| Key                                           | Type                         | Default       | Notes                                                                                                             |
| --------------------------------------------- | ---------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------- |
| `github.repos`                                | `string[]`                   | —             | Required. `"org/repo"` slugs to poll for assigned issues.                                                         |
| `github.accounts.<n>.token_env`               | string                       | —             | Env var name holding the token. Validated to be **set**.                                                          |
| `github.accounts.<n>.login`                   | string                       | —             | GitHub username.                                                                                                  |
| `github.orgs.<org>`                           | string                       | —             | Maps org slug → account name. Unknown name is an error.                                                           |
| `state.dir`                                   | string                       | —             | Required. State git repo. `~/` expanded.                                                                          |
| `tick.concurrency`                            | number                       | `1`           | Max tickets spawning phases per tick.                                                                             |
| `tick.resolve_ci_failures`                    | boolean                      | `true`        | `false` omits both CI-fix actions from `composeTickDeps`.                                                         |
| `tick.principles`                             | boolean                      | `true`        | `false` makes `appendPrinciples` a no-op and drops `@principles.md`.                                              |
| `tick.agents_md_max_tokens`                   | integer ≥0                   | `8000`        | `0` disables AGENTS.md injection entirely.                                                                        |
| `tick.max_prompt_tokens`                      | number                       | `5000`        | Threshold for oversized-prompt handling.                                                                          |
| `codebase.roots`                              | `string[]`                   | `[]`          | `~/` expanded at use. **Must be org-less** — `~/code`, not `~/code/myorg`; lookup is exactly `root/<org>/<repo>`. |
| `agent.type`                                  | `"pi"` \| `"claude-code"`    | `"pi"`        | Which CLI runs every phase.                                                                                       |
| `pi.provider`                                 | `"anthropic"` \| `"bedrock"` | `"anthropic"` | Ignored unless `agent.type = "pi"`.                                                                               |
| `pi.packages`                                 | `string[]`                   | `[]`          | Installed at the start of each tick.                                                                              |
| `jira.base_url`, `jira.project`               | string                       | —             | Both required if `[jira]` is present.                                                                             |
| `todo_txt.file`                               | string                       | —             | Required if `[todo_txt]` is present. `~/` expanded.                                                               |
| `phases.defaults.<phase>.model` / `.thinking` | string                       | see below     | Per-phase override.                                                                                               |

### Per-phase models

Phase keys: `intake`, `enrichment`, `spec`, `plan`, `implementation`,
`"conflict-resolution"`, `"ci-fix"` (the hyphenated two need TOML quoting).
Resolution order is ticket frontmatter → `[phases.defaults]` →
`PHASE_MODEL_DEFAULTS` (`src/phases/model.ts`). `thinking` accepts `off`,
`minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

```toml
[phases.defaults.intake]
model = "claude-haiku-4-5"
thinking = "off"

[phases.defaults."ci-fix"]
model = "claude-sonnet-4-6"
thinking = "high"
```

Ancillary LLM calls (self-review, approval classification, short titles,
`apply-learning`) are **not** configurable here — they pin their model at the
call site. Do not add a config knob for them.

### Ceremony schedule

```toml
# {stateDir}/ceremonies/standup/config.toml
time = "09:00"          # required, local time
interval_hours = 4      # optional; omit for once per day
workdays_only = true    # optional, default false
```

## Adding a new config key

Four edits, in order — a key added to `config.toml` alone is silently ignored:

1. `src/state/types.ts` — add the camelCase field to `Config`.
2. `src/config.ts` — read the snake_case key, validate its type with an explicit
   `throw new Error("config.toml: [section].key must be a …")`, apply the
   default.
3. `src/compose.ts` — thread it into the deps it affects. Nothing else reads
   `Config` for adapter construction.
4. `README.md` "Config" section — document it, then run `deno fmt`.

Add a case to `src/config_test.ts` covering the default and the invalid-type
throw.

## Gotchas

- **Unvalidated casts.** `tick.concurrency`, `github.repos`, and
  `codebase.roots` are cast, not checked. `concurrency = "two"` loads without
  complaint and breaks later. Get the type right; add validation if you touch
  that field.
- **Missing `[github]` or `[state]` gives an opaque error** —
  `TypeError: Cannot read properties of undefined (reading 'accounts')`. That
  means the section is absent, not that accounts are misconfigured.
- **`token_env` must be set in the _current_ environment** or startup fails.
  Under launchd/cron the shell keychain is unavailable, so tokens must be in
  `~/.config/lazyboy/env` — an interactive `gh auth token` will not be there.
- **Bedrock requires overriding every phase**, including `"conflict-resolution"`
  and `"ci-fix"`, with `anthropic.`-prefixed model IDs. lazyboy does not rewrite
  model strings, and any unconfigured phase falls back to unprefixed defaults
  that fail against Bedrock.
- **`skip` in `phases.defaults` does nothing.** `PhaseModelConfig` carries a
  `skip` field, but only `ticket.phases.plan.skip` is read (`src/tick.ts`).
- **`~/` expansion is not universal.** Only `state.dir`, `todo_txt.file`, and
  `codebase.roots` are expanded. Other paths must be absolute.
