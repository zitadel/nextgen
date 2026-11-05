---
"@zitadel/cli": patch
---

`zitadel deploy --dry-run` and the deploy diff now show changes to the policy files in `.zitadel/policies/`, leaving out its test files, `README.md` and subdirectories, which no release carries.
