---
---

`packages/sdk-core` now type-checks its own source: the `typecheck` task
targeted a solution-style tsconfig with plain `tsc --noEmit`, which checks
nothing. It now builds the real program, and the config problems that
surfaced (a lone `nodenext` module setting, a config-defeating arrow in the
vite config) are fixed. All type-level and tooling; `@zitadel/sdk-core` ships
no behaviour change, so no version bump.
