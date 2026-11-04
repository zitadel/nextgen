---
"@zitadel/cli": minor
---

`zitadel deploy` and `deploy --dry-run` now warn when the config would lock existing users out. It names the schema and counts the users who lack the property a schema now signs in with (its `x-identifier`), and the users with an SSO link whose schema no flow uses any more. The check only warns and is skipped when the users cannot be read.
