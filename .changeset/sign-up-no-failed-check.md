---
"@zitadel/server": patch
---

A sign-up no longer writes an `auth.check.failed` event when it checks that its email is free, so the console's Events stop showing a failed sign-in before every new account. A sign-in with an address that has no account still writes one.
