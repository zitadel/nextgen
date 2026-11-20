---
"@zitadel/cli": patch
---

`zitadel doctor --fix` restores a missing `.zitadel/secret` from the project's credentials in `.env.development.local` and the origins the server reports, so a deleted secret no longer loops between `doctor --fix` and `setup`, which skips an app that is already set up. When `.env.development.local` does not hold the credentials, the repair says what is missing.
