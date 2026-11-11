---
"@zitadel/cli": patch
---

`zitadel auth-method sso enable` now prints the callback URI to register with the provider for each deployed origin of the project, and a note for each preview origin pattern, since providers take no wildcards. Previously it printed only the local development callback URI, so sign-in failed on the deployed app and its previews.
