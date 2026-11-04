---
"@zitadel/cli": patch
---

`zitadel auth-method sso enable --dry-run` now prints the callback URI and where to register the OAuth client, and lists the connection file, schema and flow updates and credential variables the real run would write (`would_store` in `--json`), without asking for credentials.
