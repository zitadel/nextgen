---
"@zitadel/server": patch
---

The OpenAPI document gets the fixes a vacuum lint found: generated error and event schemas have kebab-case names, strings the server never leaves empty require a character, lists are bounded, the set-password request marks `password` write-only, the OAuth2 flow names a `refreshUrl`, and a global security requirement is the fallback for an operation that names none. A request that sends a list longer than the new bound is now refused.
