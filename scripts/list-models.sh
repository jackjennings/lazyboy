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

CHECK=false
if [[ "${1:-}" == "--check" ]]; then
  CHECK=true
fi

MODELS=$(curl -s https://api.anthropic.com/v1/models \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  | jq -r '.data[] | "\(.id)\t\(.display_name)"')

if ! $CHECK; then
  echo "$MODELS" | column -t -s $'\t'
  exit 0
fi

RESPONSE_FILE=$(mktemp)
trap 'rm -f "$RESPONSE_FILE"' EXIT

while IFS=$'\t' read -r id name; do
  for attempt in 1 2 3; do
    response=$(curl -s -o "$RESPONSE_FILE" -w '%{http_code}' \
      https://api.anthropic.com/v1/messages \
      -H "x-api-key: $ANTHROPIC_API_KEY" \
      -H "anthropic-version: 2023-06-01" \
      -H "content-type: application/json" \
      -d "$(jq -n --arg model "$id" '{model: $model, max_tokens: 1, messages: [{role: "user", content: "hi"}]}')")

    if [[ "$response" != "429" ]]; then
      break
    fi
    sleep "$attempt"
  done

  if [[ "$response" == "200" ]]; then
    printf '%s\t%s\tOK\n' "$id" "$name"
  else
    error=$(jq -r '.error.message // "unknown error"' "$RESPONSE_FILE")
    printf '%s\t%s\tFAIL (%s: %s)\n' "$id" "$name" "$response" "$error"
  fi
done <<< "$MODELS" | column -t -s $'\t'
