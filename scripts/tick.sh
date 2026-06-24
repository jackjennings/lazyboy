#!/bin/bash
set -e

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

LAZYBOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load secrets from env file if present
if [ -f "$HOME/.config/lazyboy/env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$HOME/.config/lazyboy/env"
  set +a
fi

export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null)}"
export GITHUB_LOGIN="${GITHUB_LOGIN:-$(gh api user --jq .login 2>/dev/null)}"

exec deno run --allow-all "$LAZYBOY_DIR/src/index.ts" tick
