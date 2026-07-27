#!/bin/bash
set -e

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

LAZYBOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$HOME/.config/lazyboy/config.toml"
CONFIG_DIR="$HOME/.config/lazyboy"
LAZYBOY_STATE_DIR="$HOME/.lazyboy"

export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}"
export GITHUB_LOGIN="${GITHUB_LOGIN:-$(gh api user --jq .login 2>/dev/null)}"

CODEBASE_ROOTS=""
STATE_GIT_DIR=""
if [ -f "$CONFIG_FILE" ]; then
  CODEBASE_ROOTS=$(python3 -c "
import sys, os
try:
    import tomllib
except ImportError:
    sys.exit(0)
with open(sys.argv[1], 'rb') as f:
    c = tomllib.load(f)
h = os.environ.get('HOME', '')
expand = lambda p: h + p[1:] if p.startswith('~') else p
print(','.join(expand(r) for r in c.get('codebase', {}).get('roots', [])))
" "$CONFIG_FILE" 2>/dev/null || true)
  STATE_GIT_DIR=$(python3 -c "
import sys, os
try:
    import tomllib
except ImportError:
    sys.exit(0)
with open(sys.argv[1], 'rb') as f:
    c = tomllib.load(f)
h = os.environ.get('HOME', '')
p = c.get('state', {}).get('dir', '')
print(h + p[1:] if p.startswith('~') else p)
" "$CONFIG_FILE" 2>/dev/null || true)
fi

ALLOW_READ="$CONFIG_DIR,$LAZYBOY_STATE_DIR,$LAZYBOY_DIR"
ALLOW_WRITE="$LAZYBOY_STATE_DIR"
if [ -n "$CODEBASE_ROOTS" ]; then
  ALLOW_READ="$ALLOW_READ,$CODEBASE_ROOTS"
fi
if [ -n "$STATE_GIT_DIR" ]; then
  ALLOW_READ="$ALLOW_READ,$STATE_GIT_DIR"
  ALLOW_WRITE="$ALLOW_WRITE,$STATE_GIT_DIR"
fi

SHELL_PATH="${SHELL:-/bin/sh}"

"$LAZYBOY_DIR/bin/lazyboy" update || true
exec deno run \
  "--allow-read=$ALLOW_READ" \
  "--allow-write=$ALLOW_WRITE" \
  "--allow-net=api.github.com,api.anthropic.com" \
  "--allow-env=HOME,GITHUB_TOKEN,ANTHROPIC_API_KEY,GITHUB_LOGIN,SHELL,JIRA_EMAIL,JIRA_API_TOKEN,PATH" \
  "--allow-run=git,deno,pi,claude,osascript,crontab,gh,tail,$SHELL_PATH" \
  "--allow-sys=kill" \
  "$LAZYBOY_DIR/src/index.ts" tick
