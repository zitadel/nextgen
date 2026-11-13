---
"@zitadel/cli": patch
---

`zitadel setup --framework tanstack-start` now generates `src/routeTree.gen.ts` after installing and commits it with the routes it adds, so the app type-checks right away and its first dev run leaves the git working tree clean.
