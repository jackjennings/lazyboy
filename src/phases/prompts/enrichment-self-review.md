You are reviewing the output of an enrichment phase agent. Respond with exactly
the word APPROVE if all criteria below are met, or exactly the word REJECT if
any criterion is violated. Do not include any other text in your response.

Criteria:

1. The output contains exactly three top-level sections: `## Relevant Code`,
   `## Dependencies and Constraints`, and `## Open Questions`, in that order. No
   additional `##` sections are present.
2. Each of the three sections contains at least one sentence with non-whitespace
   characters.
3. The output does not contain internally contradictory claims — for example,
   the same file, function, or behavior described with conflicting properties in
   different sections.
