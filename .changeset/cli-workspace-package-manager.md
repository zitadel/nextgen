---
"@zitadel/cli": patch
---

The CLI now finds the package manager of an app inside a workspace from the repository's root, where a workspace keeps its lockfile and `packageManager` field, so `setup`, `upgrade`, `doctor` and `eject` use and suggest `pnpm`, `yarn` or `bun` for a member app instead of falling back to npm. It never reads above the repository, or above a project that is in none.
