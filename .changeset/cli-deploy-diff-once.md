---
"@zitadel/cli": patch
---

`zitadel deploy` and `deploy --dry-run` print the diff of `.zitadel/` once on a terminal, as they already did when piped, instead of twice.
