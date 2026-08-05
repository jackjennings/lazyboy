#!/bin/bash
set -e

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

LAZYBOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# cron runs with no keychain access, so gh auth token yields nothing; load
# credentials from the env file the same way bin/lazyboy does.
if [ -f "$HOME/.config/lazyboy/env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$HOME/.config/lazyboy/env"
  set +a
fi

"$LAZYBOY_DIR/bin/lazyboy" update || true
exec deno run --allow-all "$LAZYBOY_DIR/src/index.ts" tick
