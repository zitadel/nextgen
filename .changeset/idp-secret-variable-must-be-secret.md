---
"@zitadel/server": patch
---

A deploy is refused with `dep.variables_not_secret` when an identity provider's `client_secret` names a variable stored as a plain value, instead of every sign-in through that provider failing.
