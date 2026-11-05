---
"@zitadel/cli": patch
---

`zitadel deploy --dry-run` and the deploy diff now show changes to `.zitadel/policies/`, leaving out policy test files, which no release carries.
