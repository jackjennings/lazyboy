#!/bin/bash
set -e

msg_file="$1"

subject=""
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" != "#"* ]] && [[ -n "$line" ]]; then
    subject="$line"
    break
  fi
done < "$msg_file"

if [[ "$subject" == 'Revert "'* ]]; then
  exit 0
fi

pattern='^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.+\))?(!)?: .+'
if ! [[ "$subject" =~ $pattern ]]; then
  echo "Invalid commit message: $subject" >&2
  exit 1
fi
