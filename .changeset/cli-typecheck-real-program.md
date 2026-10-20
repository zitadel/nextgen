---
---

`apps/cli` now type-checks its own source: the `typecheck` task targeted a
solution-style tsconfig with plain `tsc --noEmit`, which checks nothing. It
now builds the real program, and the 30 pre-existing errors that surfaced are
fixed. All type-level; `@zitadel/cli` ships no behaviour change, so no version
bump.
