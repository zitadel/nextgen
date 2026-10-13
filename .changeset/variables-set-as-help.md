---
"@zitadel/cli": patch
---

`zitadel variables set --help` no longer says that a reference to a whole field keeps a number variable a number. The platform resolves `${{ NAME }}` references only in an OIDC identity provider connection's `client_id` and `client_secret` today, and both take a string.
