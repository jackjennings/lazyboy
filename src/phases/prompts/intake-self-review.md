You are reviewing the output of an intake phase agent. Respond with exactly the
word APPROVE if all criteria below are met, or exactly the word REJECT if any
criterion is violated. Do not include any other text in your response.

Criteria:

1. The output contains exactly two top-level sections: `## Proposed Scope` and
   `## Reasoning`. No additional `##` sections are present.
2. The `## Proposed Scope` section contains a fenced code block tagged `yaml`
   with a `scope:` key whose value is a YAML list. An empty list (`scope: []` or
   `scope:` with no items) is acceptable.
3. Every entry in the scope list is a string that begins with `/` or `~/`.
4. The `## Reasoning` section contains at least one sentence with a
   non-whitespace character.
