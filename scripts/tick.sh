#!/bin/bash
set -e

for dir in /usr/local/bin /opt/homebrew/bin "$HOME/.local/bin"; do
  [ -d "$dir" ] || continue
  case ":$PATH:" in *":$dir:"*) ;; *) PATH="$dir:$PATH" ;; esac
done
export PATH

LAZYBOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# cron runs with no keychain access, so gh auth token yields nothing; load
# credentials from the env file the same way bin/lazyboy does.
if [ -f "$HOME/.config/urras/env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$HOME/.config/urras/env"
  set +a
fi

# host-specific additions stay out of the repo; tick.sh owns the append so a
# malformed value cannot clobber the entry `exec deno` depends on.
if [ -n "$LAZYBOY_PATH" ]; then
  export PATH="$LAZYBOY_PATH:$PATH"
fi

exec deno run --allow-all "$LAZYBOY_DIR/src/index.ts" tick
