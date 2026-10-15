---
"@zitadel/cli": patch
---

`zitadel variable set --help` no longer says that a reference to a whole field keeps a number variable a number. The server resolves `${{ NAME }}` references only in an OIDC identity provider connection's `client_id` and `client_secret` today, and both take a string.
