#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="$HOME/.config/lazyboy/env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "ANTHROPIC_API_KEY not set in $ENV_FILE" >&2
  exit 1
fi

curl -s https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  | jq -r '.data[] | "\(.id)\t\(.display_name)"' \
  | column -t -s $'\t'
