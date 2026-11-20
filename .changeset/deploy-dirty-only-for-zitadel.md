---
"@zitadel/cli": patch
---

`deploy` no longer records a release as built from an uncommitted tree because of a file outside `.zitadel/`. A modified `package.json` or app file leaves the release clean, so the next `deploy --dry-run` still shows a diff.
