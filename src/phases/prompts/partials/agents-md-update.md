Most changes establish no project-wide convention and must not touch
`AGENTS.md`. Adding nothing is the common, correct outcome. Update `AGENTS.md`
(in the same commit as the code) only when a change establishes, replaces, or
removes a project-wide convention AND all of these hold:

- A reader could not learn it from a single named file or from the tests.
- It stays true after the code that prompted it is refactored away.
- It is not already documented in `AGENTS.md`.

What earns a place: non-obvious constraints, invariants, and prohibitions ("do
not add X", "Y must be registered before Z"); configuration and how-to not
discoverable by reading a single file (`config.toml` examples, "create this
file, no code change needed"); surprising or easy-to-violate cross-module
wiring.

Do not narrate what the code does. If a reader could learn it by reading the
named file or function, link to that file instead — narration goes stale and
duplicates the source.

When you do edit `AGENTS.md`, leave the section shorter: edit the existing
relevant section in place, delete any statement this change makes false or that
merely narrates code, and do not append a new section when one already covers
the same topic. A net increase in lines should be rare.
