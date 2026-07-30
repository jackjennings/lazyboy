## Principles

`principles.md` is injected into every future phase prompt, so it is expensive
and must stay small (~10 bullets total). Record something here only if ALL of
these hold:

- It is a general engineering preference or idiom — a pattern to prefer or an
  idiom to avoid — not a fact about this codebase. File paths, function
  contracts, config values, org names, and regexes belong in AGENTS.md, a code
  comment, or config, never here.
- It would change how you approach an unrelated future ticket, not just this
  one.
- It is not already documented in AGENTS.md.
- It stays true after the code that prompted it is refactored away.
- It is non-obvious — a competent engineer would not already default to it.

If nothing meets that bar, omit this section. Writing nothing is the common,
correct outcome.
