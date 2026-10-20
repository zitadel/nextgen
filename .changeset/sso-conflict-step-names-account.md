---
"@zitadel/server": minor
---

The "You already have an account" step after a sign-in with an identity provider now carries the account's email when the provider verified it (as `step.identifier`, so a password manager offers the matching password), no longer offers the provider that just led there, and offers "Use a passkey" only to an account that has one.
