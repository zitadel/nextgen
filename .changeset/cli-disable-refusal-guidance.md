---
"@zitadel/cli": patch
---

`zitadel auth-method password disable` and `auth-method passkey disable` now say, when a login flow still uses the method, what each step keeps without it, which purpose it starts and which transitions lead to it, instead of only saying to remove the method from those steps.
